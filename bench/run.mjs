// Step 0 of the build plan: the plain keyword-search baseline.
//
// Splits the repo's markdown into sections, loads them into an in-memory Postgres (PGlite, the
// same engine the tests use) with a tsvector, and asks every question in questions.jsonl. A hit
// is a returned section whose file and heading path match one of the question's gold sources.
//
//   node bench/run.mjs                 print the table, write bench/results/<label>.json
//   node bench/run.mjs --label foo     name the results file
//   node bench/run.mjs --show q07      print the top 5 sections for one question
//   node bench/run.mjs --embed local   add the vector and hybrid modes (step 4, D44; embed.mjs)
//
// Without --embed no model is called. Later steps report against these numbers (step 0).
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { benchEmbedder } from "./embed.mjs";

const ROOT = join(import.meta.dirname, "..");
const K = [1, 3, 5, 10];
const MAX_CHUNK = 1500;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

/** The corpus: what an agent could have read about sky-brain's history. */
function corpusFiles() {
  const out = ["README.md", "CLAUDE.md"];
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, name);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (name.endsWith(".md")) out.push(rel);
    }
  };
  walk("docs");
  walk("plans");
  return out.sort();
}

/** Sections by heading (#, ##, ###), each with its heading path; long ones are cut. */
function chunks(file) {
  const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
  const path = [];
  const out = [];
  let buf = [];
  let inFence = false;
  const flush = () => {
    const text = buf.join("\n").trim();
    buf = [];
    if (!text) return;
    for (let i = 0; i < text.length; i += MAX_CHUNK) {
      out.push({
        file,
        heading: path.join(" > "),
        text: text.slice(i, i + MAX_CHUNK),
      });
    }
  };
  for (const line of lines) {
    if (line.startsWith("```")) inFence = !inFence;
    const m = !inFence && /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      path.length = m[1].length - 1;
      path[m[1].length - 1] = m[2].trim();
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

function isGold(chunk, gold) {
  return gold.some(
    (g) =>
      chunk.file === g.file &&
      chunk.heading.toLowerCase().includes(g.heading.toLowerCase()),
  );
}

async function openDb() {
  const db = await PGlite.create({ extensions: { vector } });
  await db.exec(`
    create extension vector;
    create table chunks (
      id serial primary key, file text, heading text, text text,
      tsv tsvector generated always as (
        setweight(to_tsvector('english', heading), 'A') || setweight(to_tsvector('english', text), 'B')
      ) stored
    );
    create index on chunks using gin (tsv);
  `);
  return db;
}

// Two plain modes. "and": every question word must match (Postgres websearch semantics).
// "or": any word may match, ranked by ts_rank_cd. Neither uses synonyms, vectors or links.
const WORDS = {
  and: `select id, file, heading, ts_rank_cd(tsv, q) r from chunks, websearch_to_tsquery('english', $1) q
        where tsv @@ q order by r desc, id limit $2`,
  or: `select id, file, heading, ts_rank_cd(tsv, q) r from chunks,
        to_tsquery('simple', replace(plainto_tsquery('english', $1)::text, '&', '|')) q
        where tsv @@ q order by r desc, id limit $2`,
};
const wordMode =
  (sql) =>
  async (q, n = 10) =>
    (await db.query(sql, [q, n])).rows;

// With --embed: nearest sections by cosine distance, and RRF (k = 60) over "or" and vectors,
// 50 candidates from each, as the server does (packages/memory/src/search.ts).
const RRF_K = 60;
const CANDIDATES = 50;
let embedder;
const vectorMode = async (q, n = 10) => {
  const [v] = await embedder.embed([q], "query");
  return (
    await db.query(
      `select id, file, heading, emb <=> $1::halfvec d from chunks order by d limit $2`,
      [`[${v.join(",")}]`, n],
    )
  ).rows;
};
const hybridMode = async (q, n = 10) => {
  const lists = [
    await MODES.or(q, CANDIDATES),
    await vectorMode(q, CANDIDATES),
  ];
  const fused = new Map();
  for (const list of lists) {
    list.forEach((row, i) => {
      const f = fused.get(row.id) ?? { row, score: 0 };
      f.score += 1 / (RRF_K + i + 1);
      fused.set(row.id, f);
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((f) => f.row);
};

const MODES = { and: wordMode(WORDS.and), or: wordMode(WORDS.or) };

const questions = readFileSync(
  join(import.meta.dirname, "questions.jsonl"),
  "utf8",
)
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const db = await openDb();
const files = corpusFiles();
const all = files.flatMap(chunks);
for (const c of all) {
  await db.query(
    "insert into chunks (file, heading, text) values ($1, $2, $3)",
    [c.file, c.heading, c.text],
  );
}
const total = all.length;

const embedName = flag("--embed");
if (embedName) {
  embedder = await benchEmbedder(embedName);
  // A section's heading path and text stand in for an entry's title and summary.
  const vecs = await embedder.embed(
    all.map((c) => `${c.heading}\n${c.text}`),
    "document",
  );
  await db.exec(`alter table chunks add column emb halfvec(${vecs[0].length})`);
  for (let i = 0; i < all.length; i++) {
    await db.query("update chunks set emb = $1::halfvec where id = $2", [
      `[${vecs[i].join(",")}]`,
      i + 1,
    ]);
  }
  MODES.vector = vectorMode;
  MODES.hybrid = hybridMode;
}

const show = flag("--show");
if (show) {
  const q = questions.find((x) => x.id === show);
  for (const [mode, search] of Object.entries(MODES)) {
    const rows = await search(q.question);
    console.log(`\n${mode}: ${q.question}`);
    for (const r of rows.slice(0, 5))
      console.log(
        `  ${isGold(r, q.gold) ? "*" : " "} ${r.file} :: ${r.heading}`,
      );
  }
  process.exit(0);
}

const results = {};
for (const [mode, search] of Object.entries(MODES)) {
  const per = [];
  for (const q of questions) {
    const t0 = performance.now();
    const rows = await search(q.question);
    const ms = performance.now() - t0;
    const rank = rows.findIndex((r) => isGold(r, q.gold)) + 1; // 0 = not in top 10
    per.push({
      id: q.id,
      type: q.type,
      rank,
      returned: rows.length,
      ms: +ms.toFixed(2),
    });
  }
  const n = per.length;
  const recall = Object.fromEntries(
    K.map((k) => [
      `recall@${k}`,
      +(per.filter((p) => p.rank && p.rank <= k).length / n).toFixed(3),
    ]),
  );
  const mrr = +(
    per.reduce((s, p) => s + (p.rank ? 1 / p.rank : 0), 0) / n
  ).toFixed(3);
  const empty = per.filter((p) => p.returned === 0).length;
  const sorted = per.map((p) => p.ms).sort((a, b) => a - b);
  results[mode] = {
    ...recall,
    mrr,
    no_results: empty,
    p50_ms: sorted[Math.floor(n / 2)],
    per_question: per,
  };
}

const label =
  flag("--label") ??
  `keyword-baseline-${new Date().toISOString().slice(0, 10)}`;
const out = {
  label,
  run_at: new Date().toISOString(),
  ...(embedder ? { embedding_model: embedder.model } : {}),
  corpus: { files: files.length, chunks: total },
  questions: questions.length,
  modes: results,
};
mkdirSync(join(import.meta.dirname, "results"), { recursive: true });
const outPath = join(import.meta.dirname, "results", `${label}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");

console.log(
  `corpus: ${files.length} files, ${total} sections; ${questions.length} questions`,
);
console.log(
  "mode  " +
    K.map((k) => `R@${k}`.padStart(6)).join("") +
    "    MRR  empty  p50ms",
);
for (const [mode, r] of Object.entries(results)) {
  console.log(
    mode.padEnd(6) +
      K.map((k) => r[`recall@${k}`].toFixed(2).padStart(6)).join("") +
      r.mrr.toFixed(3).padStart(7) +
      String(r.no_results).padStart(7) +
      String(r.p50_ms).padStart(7),
  );
}
console.log(`written: ${relative(ROOT, outPath)}`);
