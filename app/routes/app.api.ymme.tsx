import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const level = url.searchParams.get("level");

  if (!level) {
    return data({ error: "Missing 'level' query parameter" }, { status: 400 });
  }

  switch (level) {
    case "makes": {
      const { data: makes, error } = await db
        .from("ymme_makes")
        .select("id, name, country, logo_url")
        .eq("active", true)
        .order("name");

      if (error) {
        return data({ error: error.message }, { status: 500 });
      }

      return data({ makes });
    }

    case "models": {
      const makeId = url.searchParams.get("make_id");
      if (!makeId) {
        return data(
          { error: "Missing 'make_id' for level=models" },
          { status: 400 },
        );
      }

      const { data: models, error } = await db
        .from("ymme_models")
        .select("id, name, generation, year_from, year_to, body_type")
        .eq("make_id", makeId)
        .eq("active", true)
        .order("name")
        .order("year_from", { ascending: false });

      if (error) {
        return data({ error: error.message }, { status: 500 });
      }

      return data({ models });
    }

    case "years": {
      const modelId = url.searchParams.get("model_id");
      if (!modelId) {
        return data(
          { error: "Missing 'model_id' for level=years" },
          { status: 400 },
        );
      }

      // Get distinct year ranges from engines for this model
      const { data: engines, error } = await db
        .from("ymme_engines")
        .select("year_from, year_to")
        .eq("model_id", modelId)
        .eq("active", true);

      if (error) {
        return data({ error: error.message }, { status: 500 });
      }

      // Build a sorted set of distinct individual years from engine year ranges
      const yearSet = new Set<number>();
      for (const engine of engines ?? []) {
        const from = engine.year_from;
        const to = engine.year_to ?? new Date().getFullYear();
        for (let y = from; y <= to; y++) {
          yearSet.add(y);
        }
      }

      const years = Array.from(yearSet).sort((a, b) => b - a); // descending

      return data({ years });
    }

    case "engines": {
      const modelId = url.searchParams.get("model_id");
      const year = url.searchParams.get("year");

      if (!modelId) {
        return data(
          { error: "Missing 'model_id' for level=engines" },
          { status: 400 },
        );
      }

      let query = db
        .from("ymme_engines")
        .select(
          "id, code, name, displacement_cc, fuel_type, power_hp, power_kw, torque_nm, year_from, year_to",
        )
        .eq("model_id", modelId)
        .eq("active", true)
        .order("name");

      // If a year is provided, filter engines whose range includes that year
      if (year) {
        const y = parseInt(year, 10);
        if (!isNaN(y)) {
          query = query.lte("year_from", y).or(`year_to.gte.${y},year_to.is.null`);
        }
      }

      const { data: engines, error } = await query;

      if (error) {
        return data({ error: error.message }, { status: 500 });
      }

      return data({ engines });
    }

    default:
      return data(
        { error: `Unknown level: '${level}'. Use: makes, models, years, engines` },
        { status: 400 },
      );
  }
}
