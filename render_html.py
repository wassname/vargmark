"""
Render argdown JSON to enriched HTML with credence coloring and computed conclusions.

Also prints verification output to stdout (verify + render in one step).

Produces a self-contained HTML file for human verification.
The rendered view puts the bottom line first, then shows premises with sources.
"""
from __future__ import annotations

import json
import sys
from html import escape
from pathlib import Path

from verify_argdown import (
    extract_relations,
    extract_statements,
    check_pcs_credences,
    check_credence_consistency,
    check_math,
    check_graph,
    crux_analysis,
    propagate_credences,
    format_propagation,
)


def credence_color(c: float) -> str:
    """Map credence [0,1] to a hue from red (0) through yellow (0.5) to green (1)."""
    hue = c * 120
    return f"hsl({hue:.0f}, 70%, 45%)"


def credence_bg(c: float) -> str:
    """Light background version of credence color."""
    hue = c * 120
    return f"hsl({hue:.0f}, 60%, 92%)"


def render_credence(c: float, label: str = "", reason: str = "") -> str:
    """Render a credence as a colored badge with tooltip. reason shows on hover."""
    pct = f"{c*100:.0f}%"
    parts = [f"{label}: {c:.2f}" if label else f"{c:.2f}"]
    if reason:
        parts.append(reason)
    title = " -- ".join(parts)
    return (
        f'<span class="credence" style="color:{credence_color(c)}; '
        f'background:{credence_bg(c)}; padding:2px 6px; border-radius:4px; '
        f'font-weight:600" title="{escape(title)}">{pct}</span>'
    )


def extract_link(premise: dict) -> tuple[str | None, str | None]:
    """Extract (link_name, link_url) from a premise's ranges."""
    text = premise.get("text", "")
    for r in premise.get("ranges", []):
        if r.get("type") == "link":
            url = r.get("url")
            # argdown range stop is inclusive, so +1 for python slice
            name = text[r["start"]:r["stop"] + 1] if "start" in r and "stop" in r else None
            return name, url
    return None, None


def extract_quote(text: str) -> str | None:
    """Extract blockquote content from premise text."""
    for marker in ('>"', "> "):
        idx = text.find(marker)
        if idx >= 0:
            return text[idx + 1:].strip().strip('"')
    return None


def conclusion_relation(conc_title: str, relations: list[dict]) -> tuple[str, str] | None:
    """Find the relation type and target for a conclusion. Returns (type, target) or None."""
    for rel in relations:
        if rel["from"] == conc_title:
            return rel["relationType"], rel["to"]
    return None


def render_argument(arg_name: str, arg: dict, statements: dict, relations: list[dict]) -> str:
    """Render a PCS argument as HTML."""
    pcs = arg.get("pcs", [])
    if not pcs:
        return ""

    premises = [m for m in pcs if m.get("role") == "premise"]
    conclusions = [m for m in pcs if m.get("role") == "main-conclusion"]

    # Determine argument type (supports/challenges) from conclusion relation
    arg_type = None
    rel_target = None
    for conc in conclusions:
        rel = conclusion_relation(conc.get("title", ""), relations)
        if rel:
            arg_type, rel_target = rel
            break

    # Color-coded border: green for entails, red for contrary
    border_color = {"entails": "#2d9a2d", "contrary": "#d9534f"}.get(arg_type, "#e0e0e0")
    rel_label = {"entails": "supports", "contrary": "challenges", "contradictory": "contradicts"}.get(arg_type)

    lines = [f'<div class="argument" style="border-left: 4px solid {border_color};">']
    lines.append(f'<h3>{escape(arg_name)}</h3>')

    # Premises
    for i, p in enumerate(premises, 1):
        data = p.get("data") or {}
        credence = data.get("credence")
        reason = data.get("reason", "")
        title = p.get("title", "?")

        link_name, link_url = extract_link(p)
        tags = p.get("tags", [])
        tag_str = " ".join(f'<span class="tag">#{t}</span>' for t in tags)

        lines.append(f'<div class="premise">')
        lines.append(f'<span class="premise-nr">({i})</span> ')
        lines.append(f'<strong>{escape(title)}</strong> ')
        if credence is not None:
            lines.append(render_credence(credence, "credence", reason))
        lines.append(f' {tag_str}')

        if link_url:
            display = escape(link_name) if link_name else escape(link_url)
            lines.append(f'<br><a href="{escape(link_url)}" target="_blank">{display}</a>')

        quote = extract_quote(p.get("text", ""))
        if quote:
            lines.append(f'<blockquote>"{escape(quote)}"</blockquote>')

        lines.append('</div>')

    # Inference (intermediary conclusions contain the inference text in argdown JSON)
    inferences = [m for m in pcs if m.get("role") == "intermediary-conclusion"]
    for inf in inferences:
        lines.append(f'<div class="inference-step">{escape(inf.get("text", ""))}</div>')

    # Conclusion
    for conc in conclusions:
        data = conc.get("data") or {}
        title = conc.get("title", "?")
        text = conc.get("text", "")
        inference = data.get("inference")
        reason = data.get("reason", "")
        computed = statements.get(title, {}).get("credence")

        lines.append(f'<div class="conclusion">')
        lines.append(f'<strong>{escape(title)}</strong>: {escape(text)}')
        if inference is not None:
            lines.append(f'<br>inference: {render_credence(inference, "inference", reason)}')
        if computed is not None:
            lines.append(f' &rarr; computed: {render_credence(computed, "computed credence")}')

        # Show relation as colored indicator
        if rel_label and rel_target:
            symbol = {"entails": "+>", "contrary": "->", "contradictory": "><"}.get(arg_type, "?")
            lines.append(
                f'<span class="relation-indicator" style="color:{border_color};">'
                f' {symbol} {escape(rel_target)}</span>'
            )
        lines.append('</div>')

    lines.append('</div>')
    return "\n".join(lines)


def render_html(data: dict, argdown_source: str | None = None) -> str:
    """Render full HTML page from argdown JSON."""
    top_level = [
        (t, ec) for t, ec in data.get("statements", {}).items()
        if ec.get("isUsedAsTopLevelStatement")
    ]
    title_name = top_level[0][0] if top_level else "Argument Map"
    title_text = ""
    if top_level:
        members = top_level[0][1].get("members", [])
        if members:
            title_text = members[0].get("text", "")

    statements = extract_statements(data)
    relations = extract_relations(data)

    _pcs_errors, _pcs_notes = check_pcs_credences(data, statements)
    targets = propagate_credences(statements, relations, data)

    bottom_lines = []
    for t_title, t in targets.items():
        implied = t.get("implied")
        if implied is not None:
            bottom_lines.append((t_title, implied, t))

    arguments = data.get("arguments", {})

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{escape(title_text or title_name)}</title>
<style>
body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 42em;
    margin: 2em auto;
    padding: 0 1em;
    line-height: 1.6;
    color: #333;
}}
h1 {{ color: #1a1a1a; font-size: 1.4em; }}
h2 {{ color: #555; font-size: 1.1em; border-bottom: 1px solid #ddd; padding-bottom: 0.3em; }}
h3 {{ color: #0582ca; font-size: 1em; margin-bottom: 0.5em; }}
.bottom-line {{
    background: #f8f9fa;
    border-left: 4px solid #0582ca;
    padding: 1em 1.5em;
    margin-bottom: 2em;
    font-size: 1.1em;
}}
.bottom-line .claim {{ font-weight: 600; }}
.bottom-line .via {{ font-size: 0.85em; color: #666; margin-top: 0.3em; }}
.argument {{
    margin-bottom: 2em;
    padding: 1em;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
}}
.premise {{
    margin-bottom: 0.8em;
    padding-left: 2em;
    text-indent: -2em;
}}
.premise-nr {{ color: #0582ca; font-weight: 600; }}
.tag {{ color: #66a61e; font-size: 0.85em; }}
blockquote {{
    margin: 0.5em 0 0.5em 2.5em;
    padding: 0.4em 0.8em 0.4em 1em;
    border-left: 3px solid #ccc;
    color: #555;
    font-style: italic;
    font-size: 0.9em;
}}
.inference-step {{
    border-top: 2px solid #0582ca;
    border-bottom: 2px solid #0582ca;
    padding: 0.5em 1em;
    margin: 0.8em 0;
    color: #0582ca;
    font-size: 0.9em;
    font-style: italic;
}}
.conclusion {{
    padding: 0.5em;
    background: #f8f9fa;
    border-radius: 4px;
}}
.relation-indicator {{
    font-size: 0.85em;
    font-weight: 600;
    margin-left: 0.5em;
}}
a {{ color: #0582ca; }}
.credence {{
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
}}
.section-label {{ color: #888; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.05em; }}
details.source-code {{
    margin-top: 2em;
    border-top: 1px solid #ddd;
    padding-top: 1em;
}}
details.source-code summary {{
    cursor: pointer;
    color: #888;
    font-size: 0.9em;
}}
details.source-code pre {{
    background: #f6f8fa;
    padding: 1em;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.8em;
    line-height: 1.4;
}}
</style>
</head>
<body>
<h1>{escape(title_text or title_name)}</h1>
"""

    # Bottom line first
    if bottom_lines:
        html += '<div class="bottom-line">\n'
        html += '<span class="section-label">Bottom line</span>\n'
        for t_title, implied, t in bottom_lines:
            html += f'<div class="claim">{escape(t_title)}: {render_credence(implied, "implied credence")}</div>\n'
            for name, c in t["via_entail"]:
                html += f'<div class="via">supported by {escape(name)} ({c:.2f})</div>\n'
            for name, c in t["via_contrary"]:
                html += f'<div class="via">challenged by {escape(name)} ({c:.2f}), upper bound {1-c:.2f}</div>\n'
        html += '</div>\n'

    # Arguments grouped by section
    sections = {}
    for arg_name, arg in arguments.items():
        section = None
        for m in arg.get("members", []):
            if m.get("section"):
                section = m["section"]
                break
        sections.setdefault(section, []).append((arg_name, arg))

    section_titles = {s.get("id", ""): s.get("title", "") for s in data.get("sections", [])}

    for section_id, args in sections.items():
        section_title = section_titles.get(section_id, "")
        if section_title:
            html += f'<h2>{escape(section_title)}</h2>\n'
        for arg_name, arg in args:
            html += render_argument(arg_name, arg, statements, relations)

    # Expandable raw source (instead of a relations list)
    if argdown_source:
        html += '<details class="source-code">\n'
        html += '<summary>Raw argdown source</summary>\n'
        html += f'<pre><code>{escape(argdown_source)}</code></pre>\n'
        html += '</details>\n'

    html += '</body>\n</html>'
    return html


def verify_and_print(data: dict) -> int:
    """Run verification checks and print results. Returns exit code (0=ok, 1=errors)."""
    statements = extract_statements(data)
    relations = extract_relations(data)

    all_errors = []
    all_errors += check_credence_consistency(statements, relations)
    all_errors += check_math(statements)
    all_errors += check_graph(statements, relations, data)

    # PCS check computes conclusion credences (mutates statements)
    pcs_errors, pcs_notes = check_pcs_credences(data, statements)
    all_errors += pcs_errors

    notes = crux_analysis(statements, relations)

    if all_errors:
        print(f"\n{len(all_errors)} issues found:\n")
        for e in all_errors:
            print(f"  {e}")
    else:
        print("All checks passed.")

    if notes:
        print(f"\nCrux analysis:")
        for n in notes:
            print(f"  {n}")

    if pcs_notes:
        print(f"\nPCS inference strength:")
        for line in pcs_notes:
            print(line)

    targets = propagate_credences(statements, relations, data)
    prop_lines = format_propagation(targets)
    if prop_lines:
        print(f"\nBottom line:")
        for line in prop_lines:
            print(line)

    print(f"\nSummary: {len(statements)} statements, {len(relations)} relations, "
          f"{sum(1 for s in statements.values() if s.get('credence') is not None)} with credences")

    return 1 if all_errors else 0


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if path and Path(path).exists():
        data = json.loads(Path(path).read_text())
    else:
        data = json.load(sys.stdin)

    # Try to find matching .argdown source file
    argdown_source = None
    if path:
        argdown_path = Path(path).with_suffix(".argdown")
        if argdown_path.exists():
            argdown_source = argdown_path.read_text()

    # Verify (prints to stdout)
    exit_code = verify_and_print(data)

    # Render
    output = sys.argv[2] if len(sys.argv) > 2 else "example_verified.html"
    Path(output).write_text(render_html(data, argdown_source))
    print(f"\nRendered to {output}")

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
