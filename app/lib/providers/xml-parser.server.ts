// ---------------------------------------------------------------------------
// XML Parser — lightweight server-side XML-to-object parser
// No external dependencies — uses regex-based extraction.
// Sufficient for product feed XML. For complex namespaced XML, swap in a
// proper parser like fast-xml-parser later.
// ---------------------------------------------------------------------------

export interface XmlParseResult {
  items: Record<string, string>[];
  itemCount: number;
  rootTag: string;
  itemTag: string;
}

/**
 * Parse XML text and extract repeating item elements.
 *
 * @param content  Raw XML string
 * @param itemTag  The repeating element name (e.g. "product", "item").
 *                 If omitted, auto-detects the first repeating child of the root.
 */
export function parseXml(
  content: string,
  itemTag?: string,
): XmlParseResult {
  // Strip XML declaration and comments
  const cleaned = content
    .replace(/<\?xml[^?]*\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

  // Detect root tag
  const rootMatch = cleaned.match(/^<(\w+)[\s>]/);
  const rootTag = rootMatch ? rootMatch[1] : "root";

  // Auto-detect item tag if not provided
  const effectiveItemTag = itemTag ?? detectItemTag(cleaned, rootTag);

  if (!effectiveItemTag) {
    return { items: [], itemCount: 0, rootTag, itemTag: "" };
  }

  // Extract all <itemTag>...</itemTag> blocks
  const itemRegex = new RegExp(
    `<${effectiveItemTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${effectiveItemTag}>`,
    "gi",
  );

  const items: Record<string, string>[] = [];
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(cleaned)) !== null) {
    const innerXml = match[1];
    const item = extractChildElements(innerXml);
    items.push(item);
  }

  return {
    items,
    itemCount: items.length,
    rootTag,
    itemTag: effectiveItemTag,
  };
}

/**
 * Extract the XML structure (list of paths) for mapping UI.
 */
export function extractXmlStructure(content: string): string[] {
  const cleaned = content
    .replace(/<\?xml[^?]*\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

  const paths = new Set<string>();
  collectPaths(cleaned, "", paths);
  return Array.from(paths).sort();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract immediate child elements as key-value pairs (text content only). */
function extractChildElements(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Match simple <tag>value</tag> pairs (non-greedy, no nested same-tag)
  const childRegex = /<(\w+)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
  let m: RegExpExecArray | null;

  while ((m = childRegex.exec(xml)) !== null) {
    const key = m[1];
    const value = m[2].trim();
    // If duplicate key, append with index
    if (key in result) {
      let idx = 2;
      while (`${key}_${idx}` in result) idx++;
      result[`${key}_${idx}`] = value;
    } else {
      result[key] = value;
    }
  }

  return result;
}

/** Auto-detect the most common direct child tag under the root. */
function detectItemTag(xml: string, rootTag: string): string | null {
  // Get content inside root tag
  const rootContentRegex = new RegExp(
    `<${rootTag}[^>]*>([\\s\\S]*)<\\/${rootTag}>`,
    "i",
  );
  const rootMatch = rootContentRegex.exec(xml);
  if (!rootMatch) return null;

  const inner = rootMatch[1];

  // Count direct child opening tags
  const tagCounts: Record<string, number> = {};
  const openTagRegex = /<(\w+)[\s>]/g;
  let m: RegExpExecArray | null;

  while ((m = openTagRegex.exec(inner)) !== null) {
    const tag = m[1];
    tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  }

  // Return the most frequent tag (likely the repeating item)
  let maxTag: string | null = null;
  let maxCount = 0;
  for (const [tag, count] of Object.entries(tagCounts)) {
    if (count > maxCount) {
      maxCount = count;
      maxTag = tag;
    }
  }

  return maxCount >= 1 ? maxTag : null;
}

/** Recursively collect element paths for structure discovery. */
function collectPaths(
  xml: string,
  prefix: string,
  paths: Set<string>,
  depth: number = 0,
): void {
  if (depth > 10) return; // Guard against deeply nested XML

  const childRegex = /<(\w+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;

  while ((m = childRegex.exec(xml)) !== null) {
    const tag = m[1];
    const inner = m[2];
    const path = prefix ? `${prefix}.${tag}` : tag;
    paths.add(path);

    // Check if inner content has child elements
    if (/<\w+[\s>]/.test(inner)) {
      collectPaths(inner, path, paths, depth + 1);
    }
  }
}
