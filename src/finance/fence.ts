export function appendStatement(source: string, line: string): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  let open = -1;
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (open === -1 && trimmed === "```finance") {
      open = index;
      continue;
    }
    if (open !== -1 && trimmed === "```") {
      lines.splice(index, 0, line);
      return lines.join(newline);
    }
  }
  if (open !== -1) {
    lines.push(line, "```");
    return lines.join(newline);
  }
  const prefix = source.length === 0 || source.endsWith("\n") ? source : `${source}${newline}`;
  return `${prefix}\`\`\`finance${newline}${line}${newline}\`\`\`${newline}`;
}
