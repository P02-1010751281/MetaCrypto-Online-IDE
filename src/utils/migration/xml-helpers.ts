export function hasDirectXmlField(contents: string, fieldName: string): boolean {
  return directXmlField(contents, fieldName) !== null;
}

export function directXmlField(contents: string, fieldName: string): { index: number; tag: string } | null {
  const tags = /<\/?(?:block|shadow)\b(?:[^'">]|"[^"]*"|'[^']*')*>|<field\b(?:[^'">]|"[^"]*"|'[^']*')*>/g;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(contents))) {
    if (match[0].startsWith('</')) depth--;
    else if (/^<field\b/.test(match[0])) {
      const name = match[0].match(/\bname=(['"])(.*?)\1/);
      if (depth === 0 && name?.[2] === fieldName) return { index: match.index, tag: match[0] };
    } else if (!match[0].endsWith('/>')) depth++;
  }
  return null;
}

export function matchingBlockClose(xml: string, openIndex: number): number {
  const tags = /<\/?block\b(?:[^'">]|"[^"]*"|'[^']*')*>/g;
  tags.lastIndex = openIndex;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(xml))) {
    if (match[0].startsWith('</')) depth--;
    else if (!match[0].endsWith('/>')) depth++;
    if (depth === 0) return match.index;
  }
  return -1;
}

export function xmlPartitionTarget(contents: string): string | undefined {
  const targetInput = contents.match(/<value\b[^>]*\bname=(['"])TARGET\1[^>]*>([\s\S]*?)<\/value>/);
  if (!targetInput) return undefined;
  const targetBlock = targetInput[2];
  const dataValue = targetBlock.match(/<(?:block|shadow)\b[^>]*\btype=(['"])data_value\1[^>]*>[\s\S]*?<field\b[^>]*\bname=(['"])NUM\2[^>]*>([\s\S]*?)<\/field>/);
  if (dataValue) return decodeXmlText(dataValue[3]);
  const variable = targetBlock.match(/<(?:block|shadow)\b[^>]*\btype=(['"])variables_get\1[^>]*>[\s\S]*?<field\b[^>]*\bname=(['"])VAR\2[^>]*>([\s\S]*?)<\/field>/);
  return variable ? decodeXmlText(variable[3]) : undefined;
}

export function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
