import { parseInlineMarkdown, parseMarkdownBlocks } from "./MarkdownText";

describe("MarkdownText", () => {
  it("parses bold, italic, and inline code", () => {
    expect(parseInlineMarkdown("Use **Shared Workspace**, *not* `Workspace Workspace`."))
      .toEqual([
        { type: "text", text: "Use " },
        { type: "strong", children: [{ type: "text", text: "Shared Workspace" }] },
        { type: "text", text: ", " },
        { type: "emphasis", children: [{ type: "text", text: "not" }] },
        { type: "text", text: " " },
        { type: "code", text: "Workspace Workspace" },
        { type: "text", text: "." },
      ]);
  });

  it("parses code fences, lists, blockquotes, and paragraphs", () => {
    expect(parseMarkdownBlocks([
      "Review this command:",
      "",
      "```sh",
      "agent-tick sanction --title 'Deploy'",
      "```",
      "",
      "- check the diff",
      "- run tests",
      "",
      "> Ship only after Response",
    ].join("\n"))).toEqual([
      { type: "paragraph", text: "Review this command:" },
      { type: "code", language: "sh", text: "agent-tick sanction --title 'Deploy'" },
      { type: "list", ordered: false, items: ["check the diff", "run tests"] },
      { type: "quote", text: "Ship only after Response" },
    ]);
  });

  it("leaves unmatched markers as literal text", () => {
    expect(parseInlineMarkdown("Keep **unfinished and `open"))
      .toEqual([{ type: "text", text: "Keep **unfinished and `open" }]);
  });
});
