import { type ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

export type MarkdownInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: MarkdownInline[] }
  | { type: "emphasis"; children: MarkdownInline[] };

export type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "code"; language?: string; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string };

type MarkdownInlineTextProps = {
  numberOfLines?: number;
  selectable?: boolean;
  style?: StyleProp<TextStyle>;
  text: string;
};

type MarkdownTextProps = {
  paragraphStyle?: StyleProp<TextStyle>;
  selectable?: boolean;
  style?: StyleProp<ViewStyle>;
  text: string;
};

export function MarkdownInlineText({ numberOfLines, selectable = false, style, text }: MarkdownInlineTextProps) {
  return (
    <Text numberOfLines={numberOfLines} selectable={selectable} style={style}>
      {renderInlineTokens(parseInlineMarkdown(text))}
    </Text>
  );
}

export function MarkdownText({ paragraphStyle, selectable = false, style, text }: MarkdownTextProps) {
  const blocks = parseMarkdownBlocks(text);
  if (blocks.length === 0) return null;

  return (
    <View style={[markdownStyles.container, style]}>
      {blocks.map((block, index) => renderBlock(block, index, selectable, paragraphStyle))}
    </View>
  );
}

export function parseMarkdownBlocks(input: string): MarkdownBlock[] {
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  const blocks: MarkdownBlock[] = [];
  const paragraphLines: string[] = [];
  const quoteLines: string[] = [];
  const listItems: string[] = [];
  let listOrdered = false;
  let inCodeFence = false;
  let codeLanguage: string | undefined;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
    paragraphLines.length = 0;
  };
  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    blocks.push({ type: "quote", text: quoteLines.join("\n") });
    quoteLines.length = 0;
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push({ type: "list", ordered: listOrdered, items: [...listItems] });
    listItems.length = 0;
  };
  const flushCode = () => {
    blocks.push({ type: "code", language: codeLanguage, text: codeLines.join("\n").replace(/\n+$/u, "") });
    codeLines = [];
    codeLanguage = undefined;
  };

  for (const line of normalized.split("\n")) {
    const fenceMatch = line.match(/^\s*```\s*([^`]*)?$/u);
    if (inCodeFence) {
      if (fenceMatch) {
        flushCode();
        inCodeFence = false;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (fenceMatch) {
      flushParagraph();
      flushQuote();
      flushList();
      inCodeFence = true;
      codeLanguage = fenceMatch[1]?.trim() || undefined;
      codeLines = [];
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushQuote();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/u);
    if (headingMatch) {
      flushParagraph();
      flushQuote();
      flushList();
      blocks.push({ type: "heading", level: headingMatch[1]?.length ?? 1, text: headingMatch[2]?.trim() ?? "" });
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/u);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quoteLines.push(quoteMatch[1] ?? "");
      continue;
    }
    flushQuote();

    const unorderedMatch = line.match(/^\s*[-*+]\s+(.+)$/u);
    const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/u);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const ordered = Boolean(orderedMatch);
      if (listItems.length > 0 && listOrdered !== ordered) {
        flushList();
      }
      listOrdered = ordered;
      listItems.push((orderedMatch?.[1] ?? unorderedMatch?.[1] ?? "").trim());
      continue;
    }
    flushList();

    paragraphLines.push(line.trim());
  }

  if (inCodeFence) {
    flushCode();
  }
  flushParagraph();
  flushQuote();
  flushList();

  return blocks;
}

export function parseInlineMarkdown(input: string): MarkdownInline[] {
  return parseInlineRange(input, 0, input.length);
}

function renderBlock(block: MarkdownBlock, index: number, selectable: boolean, paragraphStyle?: StyleProp<TextStyle>) {
  switch (block.type) {
    case "heading":
      return (
        <Text key={`heading:${index}`} selectable={selectable} style={[markdownStyles.heading, block.level === 1 ? markdownStyles.headingOne : null]}>
          {renderInlineTokens(parseInlineMarkdown(block.text))}
        </Text>
      );
    case "code":
      return (
        <ScrollView horizontal key={`code:${index}`} style={markdownStyles.codeScroll} contentContainerStyle={markdownStyles.codeContent}>
          <Text selectable={selectable} style={markdownStyles.codeBlockText}>{block.text || " "}</Text>
        </ScrollView>
      );
    case "list":
      return (
        <View key={`list:${index}`} style={markdownStyles.list}>
          {block.items.map((item, itemIndex) => (
            <View key={`${itemIndex}:${item}`} style={markdownStyles.listItem}>
              <Text style={markdownStyles.listMarker}>{block.ordered ? `${itemIndex + 1}.` : "•"}</Text>
              <Text selectable={selectable} style={[markdownStyles.paragraph, paragraphStyle, markdownStyles.listText]}>
                {renderInlineTokens(parseInlineMarkdown(item))}
              </Text>
            </View>
          ))}
        </View>
      );
    case "quote":
      return (
        <View key={`quote:${index}`} style={markdownStyles.quote}>
          <Text selectable={selectable} style={[markdownStyles.paragraph, paragraphStyle, markdownStyles.quoteText]}>
            {renderInlineTokens(parseInlineMarkdown(block.text))}
          </Text>
        </View>
      );
    case "paragraph":
      return (
        <Text key={`paragraph:${index}`} selectable={selectable} style={[markdownStyles.paragraph, paragraphStyle]}>
          {renderInlineTokens(parseInlineMarkdown(block.text))}
        </Text>
      );
  }
}

function renderInlineTokens(tokens: MarkdownInline[]): ReactNode[] {
  return tokens.map((token, index) => {
    switch (token.type) {
      case "code":
        return <Text key={`code:${index}`} style={markdownStyles.inlineCode}>{token.text}</Text>;
      case "strong":
        return <Text key={`strong:${index}`} style={markdownStyles.strong}>{renderInlineTokens(token.children)}</Text>;
      case "emphasis":
        return <Text key={`emphasis:${index}`} style={markdownStyles.emphasis}>{renderInlineTokens(token.children)}</Text>;
      case "text":
        return <Text key={`text:${index}`}>{token.text}</Text>;
    }
  });
}

function parseInlineRange(input: string, start: number, end: number): MarkdownInline[] {
  const tokens: MarkdownInline[] = [];
  let buffer = "";
  let index = start;

  const flushBuffer = () => {
    if (!buffer) return;
    tokens.push({ type: "text", text: buffer });
    buffer = "";
  };

  while (index < end) {
    const char = input[index];
    const next = input[index + 1];

    if (char === "\\" && next && "\\`*_".includes(next)) {
      buffer += next;
      index += 2;
      continue;
    }

    if (char === "`") {
      const closing = findClosingMarker(input, "`", index + 1, end);
      if (closing >= 0) {
        flushBuffer();
        tokens.push({ type: "code", text: input.slice(index + 1, closing) });
        index = closing + 1;
        continue;
      }
    }

    const strongMarker = input.startsWith("**", index) ? "**" : input.startsWith("__", index) ? "__" : null;
    if (strongMarker) {
      const closing = findClosingMarker(input, strongMarker, index + strongMarker.length, end);
      if (closing >= 0) {
        flushBuffer();
        tokens.push({ type: "strong", children: parseInlineRange(input, index + strongMarker.length, closing) });
        index = closing + strongMarker.length;
        continue;
      }
      buffer += strongMarker;
      index += strongMarker.length;
      continue;
    }

    if (char === "*" || char === "_") {
      const closing = findClosingMarker(input, char, index + 1, end);
      if (closing >= 0) {
        flushBuffer();
        tokens.push({ type: "emphasis", children: parseInlineRange(input, index + 1, closing) });
        index = closing + 1;
        continue;
      }
    }

    buffer += char ?? "";
    index += 1;
  }

  flushBuffer();
  return tokens;
}

function findClosingMarker(input: string, marker: string, start: number, end: number): number {
  let index = start;
  while (index <= end - marker.length) {
    const char = input[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (marker !== "`" && char === "`") {
      const codeEnd = findClosingMarker(input, "`", index + 1, end);
      if (codeEnd >= 0) {
        index = codeEnd + 1;
        continue;
      }
    }
    if (marker.length === 1 && input.startsWith(marker + marker, index)) {
      index += 2;
      continue;
    }
    if (input.startsWith(marker, index)) {
      return index;
    }
    index += 1;
  }
  return -1;
}

const markdownStyles = StyleSheet.create({
  container: {
    gap: 12,
  },
  codeBlockText: {
    color: "#f8f5ed",
    fontFamily: "monospace",
    fontSize: 14,
    lineHeight: 20,
  },
  codeContent: {
    padding: 14,
  },
  codeScroll: {
    backgroundColor: "#202124",
    borderRadius: 8,
  },
  emphasis: {
    fontStyle: "italic",
  },
  heading: {
    color: "#202124",
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 26,
  },
  headingOne: {
    fontSize: 23,
    lineHeight: 29,
  },
  inlineCode: {
    backgroundColor: "#eee5d4",
    borderRadius: 4,
    color: "#202124",
    fontFamily: "monospace",
  },
  list: {
    gap: 8,
  },
  listItem: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  listMarker: {
    color: "#5f5a4f",
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 25,
    minWidth: 18,
    textAlign: "right",
  },
  listText: {
    flex: 1,
  },
  paragraph: {
    color: "#202124",
    fontSize: 17,
    lineHeight: 25,
  },
  quote: {
    borderLeftColor: "#c7bcaa",
    borderLeftWidth: 4,
    paddingLeft: 12,
  },
  quoteText: {
    color: "#545044",
    fontStyle: "italic",
  },
  strong: {
    fontWeight: "900",
  },
});
