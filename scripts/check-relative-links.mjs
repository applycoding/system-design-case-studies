/**
 * Checks relative Markdown links against the repo and ignores external URLs.
 * Every Markdown file other than README.md must be linked from the README.
 */

import fs from "node:fs";
import path from "node:path";

function maskDocument(content) {
  const lines = content.split("\n");
  let inFence = false;
  return lines.map((line) => {
    if (/^\s{0,3}```/.test(line)) {
      inFence = !inFence;
      return "";
    }
    if (inFence) return "";
    return line.replace(/`[^`]*`/g, "");
  });
}

function slugify(text) {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_]/g, "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function collectHeadings(lines) {
  const seen = new Map();
  const slugs = new Set();
  for (const line of lines) {
    const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = slugify(match[1]);
    if (!base) continue;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

function destinationTarget(raw) {
  const trimmed = raw.trim();
  const titled = /^(.*?)\s+"[^"]*"$/.exec(trimmed);
  return (titled ? titled[1] : trimmed).trim();
}

function toRepoPath(root, fromFile, destPath) {
  const abs = path.resolve(root, path.dirname(fromFile), destPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

function findLinkProblems(root, files, exists) {
  const errors = [];
  const headings = new Map();
  const masked = new Map();
  let relativeLinks = 0;

  for (const [file, content] of files) {
    if (!file.endsWith(".md")) continue;
    const lines = maskDocument(content);
    masked.set(file, lines);
    headings.set(file, collectHeadings(lines));
  }

  if (!files.has("README.md")) errors.push("README.md is missing");

  const linkedFromReadme = new Set();
  for (const [file, lines] of masked) {
    lines.forEach((line, index) => {
      const re = /!?\[([^\]]*)\]\(([^)]+)\)/g;
      for (const match of line.matchAll(re)) {
        const dest = destinationTarget(match[2]);
        const where = `${file}:${index + 1}`;
        if (!dest) {
          errors.push(`${where}: empty link target`);
          continue;
        }
        if (dest.startsWith("//")) {
          errors.push(`${where}: protocol-relative link ${dest}`);
          continue;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(dest)) continue;

        relativeLinks += 1;
        const hash = dest.indexOf("#");
        const pathPart = hash === -1 ? dest : dest.slice(0, hash);
        const anchor = hash === -1 ? "" : decodeURIComponent(dest.slice(hash + 1));
        const target = pathPart === "" ? file : toRepoPath(root, file, pathPart);
        if (target === null) {
          errors.push(`${where}: link leaves the repo (${dest})`);
          continue;
        }
        if (!exists(target)) {
          errors.push(`${where}: missing target ${target}`);
          continue;
        }
        if (file === "README.md" && target.endsWith(".md")) linkedFromReadme.add(target);
        if (anchor) {
          if (!target.endsWith(".md")) {
            errors.push(`${where}: anchor on non-markdown file ${target}`);
            continue;
          }
          const slugs = headings.get(target);
          if (!slugs || !slugs.has(anchor)) {
            errors.push(`${where}: missing heading #${anchor} in ${target}`);
          }
        }
      }
    });
  }

  for (const file of files.keys()) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    if (!linkedFromReadme.has(file)) errors.push(`${file} is not linked from README.md`);
  }

  return { errors, relativeLinks, markdownFiles: masked.size };
}

function selfTest() {
  const root = "/virtual-root";
  const good = new Map([
    [
      "README.md",
      [
        "# Index",
        "",
        "[A](docs/a.md#out-of-scope)",
        "[License](LICENSE)",
        "[Site](https://example.com)",
        "",
        "```text",
        "[Nope](docs/missing.md)",
        "```",
        "",
      ].join("\n"),
    ],
    [
      "docs/a.md",
      ["# A", "", "## Out of scope", "", "[Back](../README.md)", "", "[Scope](#out-of-scope)", ""].join("\n"),
    ],
    ["LICENSE", "mit"],
  ]);
  const exists = (rel) => good.has(rel);
  const ok = findLinkProblems(root, good, exists);
  if (ok.errors.length > 0) {
    throw new Error(`self-test expected no errors, got ${ok.errors.join("; ")}`);
  }
  if (ok.relativeLinks < 3) throw new Error("self-test did not count relative links");

  const missing = new Map([["README.md", "# Index\n\n[Missing](docs/nope.md)\n"]]);
  const bad = findLinkProblems(root, missing, (rel) => missing.has(rel));
  if (!bad.errors.some((error) => error.includes("docs/nope.md"))) {
    throw new Error("self-test missed a broken relative link");
  }

  const orphan = new Map([
    ["README.md", "# Index\n\n[A](docs/a.md)\n"],
    ["docs/a.md", "# A\n"],
    ["docs/b.md", "# B\n"],
  ]);
  const orphanErrors = findLinkProblems(root, orphan, (rel) => orphan.has(rel));
  if (!orphanErrors.errors.some((error) => error.includes("docs/b.md"))) {
    throw new Error("self-test missed an orphan markdown file");
  }
}

function walk(dir, root, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, root, files);
    else if (entry.isFile()) {
      const rel = path.relative(root, abs).split(path.sep).join("/");
      files.set(rel, entry.name.endsWith(".md") ? fs.readFileSync(abs, "utf8") : "");
    }
  }
}

function main() {
  try {
    selfTest();
  } catch (error) {
    console.error(`link self-test failed: ${error.message}`);
    process.exit(1);
  }

  const root = process.cwd();
  const files = new Map();
  walk(root, root, files);
  const md = new Map([...files].filter(([file]) => file.endsWith(".md") || file === "LICENSE"));
  for (const [file, content] of files) {
    if (file.endsWith(".md")) md.set(file, content);
  }
  const { errors, relativeLinks, markdownFiles } = findLinkProblems(
    root,
    md,
    (rel) => fs.existsSync(path.join(root, rel)),
  );
  if (relativeLinks === 0) errors.push("no relative links found");
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(`links: ${markdownFiles} markdown file(s), ${relativeLinks} relative link(s) ok`);
}

main();
