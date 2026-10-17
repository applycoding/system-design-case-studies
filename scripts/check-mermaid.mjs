/**
 * Validates Mermaid fences in Markdown.
 *
 * flowchart, sequenceDiagram, and erDiagram are the diagrams these notes use.
 * @mermaid-js/parser does not parse those three, and @mermaid-js/mermaid-cli
 * launches a browser. This script is a small parser for the subset the notes
 * use, plus a self-test so a parser bug fails the check.
 */

import fs from "node:fs";
import path from "node:path";

const FLOW_DIRECTIONS = new Set(["TB", "TD", "BT", "RL", "LR"]);
const ER_TYPES = new Set([
  "string",
  "int",
  "bigint",
  "float",
  "double",
  "decimal",
  "bool",
  "boolean",
  "datetime",
  "date",
  "uuid",
  "text",
  "json",
  "bytes",
]);
const ER_LEFT = new Set(["||", "|o", "}|", "}o"]);
const ER_RIGHT = new Set(["||", "o|", "|{", "o{"]);
const SHAPES = [
  ["[[", "]]"],
  ["([", "])"],
  ["[(", ")]"],
  ["((", "))"],
  ["{{", "}}"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
];
const ARROWS = ["-->>", "->>", "-->", "->", "--x", "-x", "--)", "-)"];

function fail(lineOffset, message) {
  const error = new Error(message);
  error.lineOffset = lineOffset;
  throw error;
}

function stripComment(line) {
  const at = line.indexOf("%%");
  return at === -1 ? line : line.slice(0, at);
}

function skipWs(line, index) {
  let i = index;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
  return i;
}

function readId(line, index) {
  const match = /^[A-Za-z][A-Za-z0-9_]*/.exec(line.slice(index));
  if (!match) return null;
  return { id: match[0], j: index + match[0].length };
}

function meaningfulLines(text) {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    const textLine = stripComment(lines[i]).trim();
    if (textLine) kept.push({ i, text: textLine });
  }
  return kept;
}

function readPipeLabel(line, index, lineOffset) {
  if (line[index] !== "|") return { j: index };
  const end = line.indexOf("|", index + 1);
  if (end < 0) fail(lineOffset, "unclosed link label");
  const label = line.slice(index + 1, end).trim();
  if (!label) fail(lineOffset, "empty link label");
  if (label.includes("|")) fail(lineOffset, "link label contains a pipe");
  return { j: end + 1, label };
}

function readPlainArrow(line, index, prefix, lineOffset) {
  if (!line.startsWith(prefix, index)) return null;
  return readPipeLabel(line, index + prefix.length, lineOffset);
}

function readSpacedArrow(line, index, pattern) {
  const match = pattern.exec(line.slice(index));
  if (!match) return null;
  return { j: index + match[0].length, label: match[1] };
}

function readFlowLink(line, index, lineOffset) {
  const spaced = [
    /^-\.\s+(\S(?:.*?\S)?)\s+\.->/,
    /^==\s+(\S(?:.*?\S)?)\s+==>/,
    /^--\s+(\S(?:.*?\S)?)\s+-->/,
  ];
  for (const pattern of spaced) {
    const found = readSpacedArrow(line, index, pattern);
    if (found) return found;
  }
  for (const prefix of ["-.->", "==>", "-->"]) {
    const found = readPlainArrow(line, index, prefix, lineOffset);
    if (found) return found;
  }
  return null;
}

function readNode(line, index, lineOffset) {
  const id = readId(line, index);
  if (!id) return null;
  let j = id.j;
  for (const [open, close] of SHAPES) {
    if (!line.startsWith(open, j)) continue;
    const end = line.indexOf(close, j + open.length);
    if (end < 0) fail(lineOffset, `unclosed node shape for ${id.id}`);
    const label = line.slice(j + open.length, end);
    if (label.includes("\n")) fail(lineOffset, `bad node label for ${id.id}`);
    return { id: id.id, j: end + close.length };
  }
  return { id: id.id, j };
}

function parseFlowStatement(line, lineOffset) {
  let i = 0;
  let nodes = 0;
  while (i < line.length) {
    i = skipWs(line, i);
    if (i >= line.length) break;
    const node = readNode(line, i, lineOffset);
    if (!node) fail(lineOffset, `expected a node near "${line.slice(i)}"`);
    i = skipWs(line, node.j);
    nodes += 1;
    if (i >= line.length) break;
    const link = readFlowLink(line, i, lineOffset);
    if (!link) fail(lineOffset, `expected a link near "${line.slice(i)}"`);
    i = skipWs(line, link.j);
    if (i >= line.length) fail(lineOffset, "link is missing a target node");
  }
  if (nodes === 0) fail(lineOffset, "empty flowchart statement");
}

function parseSubgraph(line, lineOffset) {
  const match = /^subgraph\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+\[(.+)\])?$/.exec(line);
  if (!match) fail(lineOffset, "invalid subgraph header");
  if (match[2] !== undefined && (match[2].length === 0 || match[2].includes("]"))) {
    fail(lineOffset, "invalid subgraph title");
  }
}

function parseFlowchart(rows) {
  const header = rows[0];
  const match = /^(?:flowchart|graph)\s+(TB|TD|BT|RL|LR)$/.exec(header.text);
  if (!match || !FLOW_DIRECTIONS.has(match[1])) {
    fail(header.i, "invalid flowchart header");
  }
  let depth = 0;
  let sawNode = false;
  for (let n = 1; n < rows.length; n += 1) {
    const { i, text } = rows[n];
    if (text.startsWith("subgraph ")) {
      parseSubgraph(text, i);
      depth += 1;
      continue;
    }
    if (text === "end") {
      if (depth === 0) fail(i, "end without subgraph");
      depth -= 1;
      continue;
    }
    if (/^direction\s+(TB|TD|BT|RL|LR)$/.test(text)) {
      if (depth === 0) fail(i, "direction is only valid inside a subgraph");
      continue;
    }
    if (text.startsWith("click ")) fail(i, "click handlers are not allowed");
    if (/^classDef\s+/.test(text)) {
      if (!/^classDef\s+[A-Za-z][A-Za-z0-9_]*\s+\S(?:.*\S)?$/.test(text)) {
        fail(i, "invalid classDef");
      }
      continue;
    }
    if (/^class\s+/.test(text)) {
      const classLine = /^class\s+[A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)*\s+[A-Za-z][A-Za-z0-9_]*$/;
      if (!classLine.test(text)) fail(i, "invalid class statement");
      continue;
    }
    if (/^style\s+/.test(text)) {
      if (!/^style\s+[A-Za-z][A-Za-z0-9_]*\s+\S(?:.*\S)?$/.test(text)) {
        fail(i, "invalid style statement");
      }
      continue;
    }
    parseFlowStatement(text, i);
    sawNode = true;
  }
  if (depth !== 0) fail(rows[rows.length - 1].i, "unclosed subgraph");
  if (!sawNode) fail(header.i, "flowchart has no nodes");
}

function readArrow(line, index) {
  for (const arrow of ARROWS) {
    if (line.startsWith(arrow, index)) return { j: index + arrow.length, arrow };
  }
  return null;
}

function optionalSign(line, index) {
  if (line[index] === "+" || line[index] === "-") return index + 1;
  return index;
}

function parseSequenceMessage(line, lineOffset) {
  let i = 0;
  const left = readId(line, i);
  if (!left) fail(lineOffset, "expected a participant alias");
  i = skipWs(line, left.j);
  const arrow = readArrow(line, i);
  if (!arrow) fail(lineOffset, "expected a sequence arrow");
  i = optionalSign(line, arrow.j);
  i = skipWs(line, i);
  const right = readId(line, i);
  if (!right) fail(lineOffset, "expected a target alias");
  i = optionalSign(line, right.j);
  i = skipWs(line, i);
  if (line[i] !== ":") fail(lineOffset, "sequence message is missing a colon");
  const message = line.slice(i + 1).trim();
  if (!message) fail(lineOffset, "sequence message is empty");
}

function parseSequence(rows) {
  if (rows[0].text !== "sequenceDiagram") fail(rows[0].i, "invalid sequence header");
  const aliases = new Set();
  const stack = [];
  let sawMessage = false;
  let autonumber = false;
  for (let n = 1; n < rows.length; n += 1) {
    const { i, text } = rows[n];
    const participant = /^(participant|actor)\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+as\s+(\S(?:.*\S)?))?$/.exec(text);
    if (participant) {
      if (!participant[3] && text.includes(" as ")) fail(i, "empty participant name");
      if (aliases.has(participant[2])) fail(i, `duplicate participant ${participant[2]}`);
      aliases.add(participant[2]);
      continue;
    }
    if (text === "autonumber") {
      if (autonumber) fail(i, "autonumber is repeated");
      autonumber = true;
      continue;
    }
    const noteOver = /^Note\s+over\s+([A-Za-z][A-Za-z0-9_]*)(?:\s*,\s*([A-Za-z][A-Za-z0-9_]*))?\s*:\s*(\S(?:.*\S)?)$/.exec(text);
    const noteSide = /^Note\s+(?:right|left)\s+of\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(\S(?:.*\S)?)$/.exec(text);
    if (noteOver || noteSide) continue;
    const opened = /^(loop|alt|opt|par|critical|break)\s+(\S(?:.*\S)?)$/.exec(text);
    if (opened) {
      stack.push(opened[1]);
      continue;
    }
    if (/^else(?:\s+\S.*)?$/.test(text)) {
      if (!stack.includes("alt")) fail(i, "else is outside alt");
      continue;
    }
    if (/^and(?:\s+\S.*)?$/.test(text)) {
      if (stack[stack.length - 1] !== "par") fail(i, "and is outside par");
      continue;
    }
    if (text === "end") {
      if (stack.length === 0) fail(i, "end without a sequence block");
      stack.pop();
      continue;
    }
    const activation = /^(activate|deactivate)\s+[A-Za-z][A-Za-z0-9_]*$/.exec(text);
    if (activation) continue;
    parseSequenceMessage(text, i);
    sawMessage = true;
  }
  if (stack.length !== 0) fail(rows[rows.length - 1].i, "unclosed sequence block");
  if (!sawMessage) fail(rows[0].i, "sequence diagram has no messages");
}

function parseAttribute(line, lineOffset) {
  const match = /^(string|int|bigint|float|double|decimal|bool|boolean|datetime|date|uuid|text|json|bytes)\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+(PK|FK|UK))?(?:\s+"([^"]*)")?$/.exec(line);
  if (!match || !ER_TYPES.has(match[1])) fail(lineOffset, `invalid attribute "${line}"`);
  if (match[4] !== undefined && match[4].trim() === "") fail(lineOffset, "empty attribute comment");
}

function parseRelationship(line, lineOffset) {
  const match = /^([A-Za-z][A-Za-z0-9_]*)\s+(\S+)\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(\S(?:.*\S)?)$/.exec(line);
  if (!match) fail(lineOffset, "invalid relationship");
  const token = /^([|o{}]{2})(--|\.\.)([|o{}]{2})$/.exec(match[2]);
  if (!token || !ER_LEFT.has(token[1]) || !ER_RIGHT.has(token[3])) {
    fail(lineOffset, `bad relationship token ${match[2]}`);
  }
}

function parseEr(rows) {
  if (rows[0].text !== "erDiagram") fail(rows[0].i, "invalid erDiagram header");
  let inEntity = false;
  let sawStatement = false;
  for (let n = 1; n < rows.length; n += 1) {
    const { i, text } = rows[n];
    if (inEntity) {
      if (text === "}") {
        inEntity = false;
        continue;
      }
      parseAttribute(text, i);
      sawStatement = true;
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9_]*\s*\{$/.test(text)) {
      inEntity = true;
      sawStatement = true;
      continue;
    }
    parseRelationship(text, i);
    sawStatement = true;
  }
  if (inEntity) fail(rows[rows.length - 1].i, "unclosed entity block");
  if (!sawStatement) fail(rows[0].i, "erDiagram is empty");
}

function parseDiagram(text) {
  const rows = meaningfulLines(text);
  if (rows.length === 0) fail(0, "empty diagram");
  const header = rows[0].text;
  if (header === "sequenceDiagram") {
    parseSequence(rows);
    return;
  }
  if (header === "erDiagram") {
    parseEr(rows);
    return;
  }
  if (/^(?:flowchart|graph)\s+/.test(header)) {
    parseFlowchart(rows);
    return;
  }
  fail(rows[0].i, `unsupported diagram type "${header.split(/\s+/)[0]}"`);
}

function expectThrow(text, pattern) {
  try {
    parseDiagram(text);
  } catch (error) {
    if (!pattern.test(error.message)) {
      throw new Error(`self-test expected ${pattern}, got ${error.message}`);
    }
    return;
  }
  throw new Error(`self-test expected failure matching ${pattern}`);
}

function selfTest() {
  parseDiagram(`flowchart TD
    subgraph net [Network]
      direction LR
      op[Operator console] -->|approve| planner[LLM planner]
    end
    planner -.->|timeout| hold[Safe hold]
    classDef main fill:#fff
    class op main
  `);
  parseDiagram(`sequenceDiagram
    participant Op as Operator
    autonumber
    Op->>+Plan: Instruction
    alt within limits
      Plan-->>-Op: Accepted
    else veto
      Plan-->>Op: Veto reason
    end
    Note over Op,Plan: Plan text stays readable
  `);
  parseDiagram(`erDiagram
    PLAN {
      string plan_id PK
      string status "draft or running"
    }
    PLAN_STEP {
      string step_id PK
      string plan_id FK
    }
    PLAN ||--|{ PLAN_STEP : contains
  `);
  expectThrow("flowchart SIDEWAYS\nA-->B", /invalid flowchart header/);
  expectThrow("flowchart TD\nA -->", /missing a target node/);
  expectThrow("flowchart TD\nsubgraph n [T]\nA-->B", /unclosed subgraph/);
  expectThrow("flowchart TD\nA[foo --> B", /unclosed node shape/);
  expectThrow("sequenceDiagram\nA->>B hello", /missing a colon/);
  expectThrow("sequenceDiagram\nalt x\nA->>B: hi", /unclosed sequence block/);
  expectThrow("erDiagram\nA |--o{ B : rel", /bad relationship token/);
  expectThrow("erDiagram\nPLAN {\nnotatype name\n}", /invalid attribute/);
  expectThrow('pie title x\n"A": 1', /unsupported diagram type/);
}

function walkMarkdown(dir, root, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(abs, root, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(abs);
  }
}

function extractDiagrams(absPath) {
  const text = fs.readFileSync(absPath, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*```mermaid\s*$/.test(lines[i])) continue;
    const startLine = i + 2;
    const body = [];
    i += 1;
    for (; i < lines.length; i += 1) {
      if (/^\s*```\s*$/.test(lines[i])) break;
      body.push(lines[i]);
    }
    if (i >= lines.length) {
      throw new Error(`${absPath}:${startLine}: unclosed mermaid fence`);
    }
    blocks.push({ startLine, text: body.join("\n") });
  }
  return blocks;
}

function main() {
  try {
    selfTest();
  } catch (error) {
    console.error(`mermaid self-test failed: ${error.message}`);
    process.exit(1);
  }

  const root = process.cwd();
  const files = [];
  walkMarkdown(root, root, files);
  const errors = [];
  let diagrams = 0;
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    let blocks;
    try {
      blocks = extractDiagrams(abs);
    } catch (error) {
      errors.push(error.message.replace(abs, rel));
      continue;
    }
    for (const block of blocks) {
      diagrams += 1;
      try {
        parseDiagram(block.text);
      } catch (error) {
        const line = block.startLine + (error.lineOffset ?? 0);
        errors.push(`${rel}:${line}: ${error.message}`);
      }
    }
  }
  if (diagrams === 0) errors.push("no mermaid diagrams found");
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(`mermaid: ${diagrams} diagram(s) ok`);
}

main();
