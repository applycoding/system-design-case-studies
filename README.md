# System design case studies

Reference designs by Arpan Bom, a software and AI engineer who has worked mostly with startups.

These notes are generic designs for classes of system: a humanoid's onboard stack, ride-hailing dispatch, a multi-store point of sale, drone mission control, an edge thermal-camera pipeline, and an enterprise agent platform. They are not write-ups of any employer's internals. They do not report user counts, traffic, accuracy, or business results. Where a design needs a scale, the case study marks it as an assumption for the exercise.

## Case studies

| Note | Class of system |
| --- | --- |
| [On-robot AI stack for a humanoid](docs/01-humanoid-on-robot-ai.md) | Perception, local speech, an LLM planner, a safety layer, and teleoperation, with a person in the loop |
| [Ride-hailing dispatch backend](docs/02-ride-hailing-dispatch.md) | Matching, geo indexing, surge, and payments |
| [Multi-store point of sale with offline sync](docs/03-multi-store-pos.md) | Store-local sales during a WAN outage, then journals into an external accounting system |
| [Drone mission control](docs/04-drone-mission-control.md) | Companion computer on Jetson or Pi, flight-controller failsafes, telemetry, web and mobile clients |
| [Edge thermal camera pipeline for firefighters](docs/05-firefighter-thermal-camera.md) | On-device thermal display and alerts for an incident commander |
| [Enterprise LLM agent platform](docs/06-enterprise-llm-agent-platform.md) | Jira and GitHub tools, with policy and approval outside the model |

Each note has the same spine: requirements, a capacity estimate, an architecture diagram, a data model, APIs, trade-offs, failure modes, security, and what I would do differently.

## Architecture decision records

Copy [the ADR template](docs/adr/0000-template.md) to `docs/adr/NNNN-short-title.md` when a choice should stand on its own. The file in the repo today is the blank form, not a decision. The template links to the [humanoid architecture](docs/01-humanoid-on-robot-ai.md#architecture) only as an example of a relative link.

## Layout

| Path | What it is |
| --- | --- |
| `docs/` | The six case studies |
| `docs/adr/` | ADR template and, later, decisions |
| `scripts/check-relative-links.mjs` | Relative link checker |
| `scripts/check-mermaid.mjs` | Mermaid syntax checker |
| `.github/workflows/ci.yml` | GitHub Actions workflow |

## Checks

The checks are Markdown lint, relative links, and Mermaid syntax. GitHub Actions runs them on push to `main` and on pull requests via [the workflow](.github/workflows/ci.yml). Run the same checks locally:

```bash
npm ci
npm run check
```

Node.js 20 or newer is required. The link checker follows relative links, including headings, and ignores external URLs. It also requires every Markdown file other than this README to be linked from this page. The Mermaid checker parses `flowchart`, `graph`, `sequenceDiagram`, and `erDiagram`, which are the types these notes use. Both scripts include a small self-test.

`@mermaid-js/parser` does not parse flowchart, sequence, or ER diagrams. `@mermaid-js/mermaid-cli` runs a headless browser. This repo uses the small parser instead.

## License

[MIT](LICENSE). Copyright 2026 Arpan Bom. Contact: [applycoding@gmail.com](mailto:applycoding@gmail.com).
