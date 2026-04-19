/**
 * Transform Rules — data transformation for column mapping
 *
 * Each transform takes a string value and returns a transformed string.
 * Rules are stored as "rule_name" or "rule_name:param" in the database.
 */

export type TransformRuleId =
  | "uppercase"
  | "lowercase"
  | "trim"
  | "capitalize"
  | "prefix"
  | "suffix"
  | "regex_replace"
  | "default_value"
  | "round"
  | "multiply"
  | "divide"
  | "strip_html"
  | "extract_numbers"
  | "truncate"
  | "split_first"
  | "split_last"
  | "currency_strip";

export interface TransformRuleDefinition {
  id: TransformRuleId;
  label: string;
  description: string;
  hasParam: boolean;
  paramLabel?: string;
  paramPlaceholder?: string;
}

/**
 * Available transform rules with their metadata.
 */
export const TRANSFORM_RULES: TransformRuleDefinition[] = [
  { id: "uppercase", label: "UPPERCASE", description: "Convert to uppercase", hasParam: false },
  { id: "lowercase", label: "lowercase", description: "Convert to lowercase", hasParam: false },
  { id: "trim", label: "Trim", description: "Remove leading/trailing whitespace", hasParam: false },
  { id: "capitalize", label: "Capitalize", description: "Capitalize first letter of each word", hasParam: false },
  { id: "prefix", label: "Add Prefix", description: "Add text before the value", hasParam: true, paramLabel: "Prefix", paramPlaceholder: "SKU-" },
  { id: "suffix", label: "Add Suffix", description: "Add text after the value", hasParam: true, paramLabel: "Suffix", paramPlaceholder: "-UK" },
  { id: "regex_replace", label: "Regex Replace", description: "Replace text using regex pattern", hasParam: true, paramLabel: "Pattern → Replacement", paramPlaceholder: "s/old/new/" },
  { id: "default_value", label: "Default Value", description: "Use this value if field is empty", hasParam: true, paramLabel: "Default", paramPlaceholder: "Unknown" },
  { id: "round", label: "Round Number", description: "Round to N decimal places", hasParam: true, paramLabel: "Decimals", paramPlaceholder: "2" },
  { id: "multiply", label: "Multiply", description: "Multiply numeric value", hasParam: true, paramLabel: "Factor", paramPlaceholder: "1.2" },
  { id: "divide", label: "Divide", description: "Divide numeric value", hasParam: true, paramLabel: "Divisor", paramPlaceholder: "100" },
  { id: "strip_html", label: "Strip HTML", description: "Remove HTML tags from value", hasParam: false },
  { id: "extract_numbers", label: "Extract Numbers", description: "Extract only numeric characters", hasParam: false },
  { id: "truncate", label: "Truncate", description: "Limit to N characters", hasParam: true, paramLabel: "Max Length", paramPlaceholder: "255" },
  { id: "split_first", label: "Split (First Part)", description: "Split by delimiter and take first part", hasParam: true, paramLabel: "Delimiter", paramPlaceholder: " - " },
  { id: "split_last", label: "Split (Last Part)", description: "Split by delimiter and take last part", hasParam: true, paramLabel: "Delimiter", paramPlaceholder: " - " },
  { id: "currency_strip", label: "Strip Currency", description: "Remove currency symbols (£$€) and commas", hasParam: false },
];

/**
 * Parse a stored transform rule string like "prefix:SKU-" into id + param.
 */
export function parseTransformRule(rule: string): { id: TransformRuleId; param?: string } {
  const colonIndex = rule.indexOf(":");
  if (colonIndex === -1) {
    return { id: rule as TransformRuleId };
  }
  return {
    id: rule.slice(0, colonIndex) as TransformRuleId,
    param: rule.slice(colonIndex + 1),
  };
}

/**
 * Serialize a transform rule id + param back to storage format.
 */
export function serializeTransformRule(id: TransformRuleId, param?: string): string {
  if (!param) return id;
  return `${id}:${param}`;
}

/**
 * Apply a transform rule to a string value.
 */
export function applyTransform(value: string, ruleStr: string): string {
  const { id, param } = parseTransformRule(ruleStr);

  switch (id) {
    case "uppercase":
      return value.toUpperCase();

    case "lowercase":
      return value.toLowerCase();

    case "trim":
      return value.trim();

    case "capitalize":
      return value
        .toLowerCase()
        .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());

    case "prefix":
      return value ? `${param ?? ""}${value}` : value;

    case "suffix":
      return value ? `${value}${param ?? ""}` : value;

    case "regex_replace": {
      if (!param) return value;
      // Format: s/pattern/replacement/ or pattern→replacement
      const match = param.match(/^s\/(.+?)\/(.*)\/([gimsuy]*)$/);
      if (match) {
        try {
          const regex = new RegExp(match[1], match[3] || "g");
          return value.replace(regex, match[2]);
        } catch {
          return value;
        }
      }
      return value;
    }

    case "default_value":
      return value.trim() === "" ? (param ?? "") : value;

    case "round": {
      const num = parseFloat(value);
      if (isNaN(num)) return value;
      const decimals = parseInt(param ?? "2", 10);
      return num.toFixed(decimals);
    }

    case "multiply": {
      const num = parseFloat(value);
      const factor = parseFloat(param ?? "1");
      if (isNaN(num) || isNaN(factor)) return value;
      return (num * factor).toString();
    }

    case "divide": {
      const num = parseFloat(value);
      const divisor = parseFloat(param ?? "1");
      if (isNaN(num) || isNaN(divisor) || divisor === 0) return value;
      return (num / divisor).toString();
    }

    case "strip_html":
      return value.replace(/<[^>]*>/g, "").trim();

    case "extract_numbers":
      return value.replace(/[^0-9.,-]/g, "");

    case "truncate": {
      const maxLen = parseInt(param ?? "255", 10);
      return value.length > maxLen ? value.slice(0, maxLen) : value;
    }

    case "split_first": {
      const delimiter = param ?? " ";
      const parts = value.split(delimiter);
      return parts[0] ?? value;
    }

    case "split_last": {
      const delimiter = param ?? " ";
      const parts = value.split(delimiter);
      return parts[parts.length - 1] ?? value;
    }

    case "currency_strip":
      return value.replace(/[£$€¥₹,\s]/g, "").trim();

    default:
      return value;
  }
}

/**
 * Apply multiple transforms to a value in sequence.
 */
export function applyTransforms(value: string, rules: string[]): string {
  let result = value;
  for (const rule of rules) {
    result = applyTransform(result, rule);
  }
  return result;
}
