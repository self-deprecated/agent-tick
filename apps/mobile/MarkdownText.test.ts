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
      "agent-tick send sanction --title 'Deploy'",
      "```",
      "",
      "- check the diff",
      "- run tests",
      "",
      "> Ship only after Response",
    ].join("\n"))).toEqual([
      { type: "paragraph", text: "Review this command:" },
      { type: "code", language: "sh", text: "agent-tick send sanction --title 'Deploy'" },
      { type: "list", ordered: false, start: 1, items: ["check the diff", "run tests"] },
      { type: "quote", text: "Ship only after Response" },
    ]);
  });

  it("parses GitHub-style pipe tables", () => {
    expect(parseMarkdownBlocks([
      "Quick audit:",
      "",
      "| Command | Sends to Agent Tick? | What content |",
      "|---|---:|---|",
      "| `login`, `config` | mostly no Activity | saves config |",
      "| send status | yes | one Status Update |",
      "",
      "Done.",
    ].join("\n"))).toEqual([
      { type: "paragraph", text: "Quick audit:" },
      {
        type: "table",
        headers: ["Command", "Sends to Agent Tick?", "What content"],
        rows: [
          ["`login`, `config`", "mostly no Activity", "saves config"],
          ["send status", "yes", "one Status Update"],
        ],
      },
      { type: "paragraph", text: "Done." },
    ]);
  });

  it("continues ordered list numbers across code blocks between steps", () => {
    expect(parseMarkdownBlocks([
      "1. Log in:",
      "```sh",
      "gcloud auth login",
      "```",
      "1. Pick a project:",
      "```sh",
      "gcloud config set project demo",
      "```",
      "1. Enable Firebase:",
    ].join("\n"))).toEqual([
      { type: "list", ordered: true, start: 1, items: ["Log in:"] },
      { type: "code", language: "sh", text: "gcloud auth login" },
      { type: "list", ordered: true, start: 2, items: ["Pick a project:"] },
      { type: "code", language: "sh", text: "gcloud config set project demo" },
      { type: "list", ordered: true, start: 3, items: ["Enable Firebase:"] },
    ]);
  });

  it("leaves unmatched markers as literal text", () => {
    expect(parseInlineMarkdown("Keep **unfinished and `open"))
      .toEqual([{ type: "text", text: "Keep **unfinished and `open" }]);
  });
});
