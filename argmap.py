"""
Verified argument map tool: verify + render in one step.

Parses argdown JSON export, checks credence consistency, computes conclusions,
and renders enriched HTML with credence coloring.

Usage:
    python argmap.py example.json                          # verify + render
    python argmap.py example.json output.html              # specify output path
    npx @argdown/cli json example.argdown --stdout | python argmap.py  # pipe
"""
from __future__ import annotations

import json
import math
import sys
from html import escape
from pathlib import Path

import networkx as nx
import sympy


CONTRADICTION_TOLERANCE = 0.05  # credences should sum to 1.0 +/- this


# --- Extraction ---

def extract_statements(data: dict) -> dict[str, dict]:
    """Extract statement title -> {credence, tag, math, text}."""
    statements = {}
    for title, ec in data.get("statements", {}).items():
        info = {"title": title, "text": "", "credence": None, "tag": None, "math": None}
        d = ec.get("data", {})
        info["credence"] = d.get("credence")
        info["tag"] = d.get("tag")
        info["math"] = d.get("math")
        if ec.get("members"):
            info["text"] = ec["members"][0].get("text", "")
        statements[title] = info
    return statements


def extract_relations(data: dict) -> list[dict]:
    """Extract all relations with types (deduplicated)."""
    relations = []
    seen = set()
    for title, ec in data.get("statements", {}).items():
        for rel in ec.get("relations", []):
            key = (rel["from"], rel["to"], rel["relationType"])
            if key not in seen:
                seen.add(key)
                relations.append(rel)
    for title, arg in data.get("arguments", {}).items():
        for rel in arg.get("relations", []):
            key = (rel["from"], rel["to"], rel["relationType"])
            if key not in seen:
                seen.add(key)
                relations.append(rel)
    return relations


# --- Verification checks ---

def check_credence_consistency(statements: dict, relations: list) -> list[str]:
    """Check credences against strict mode logical constraints."""
    errors = []
    for rel in relations:
        a, b = statements.get(rel["from"], {}), statements.get(rel["to"], {})
        ca, cb = a.get("credence"), b.get("credence")
        if ca is None or cb is None:
            continue
        rtype = rel["relationType"]
        if rtype == "entails" and cb < ca:
            errors.append(
                f"ENTAILMENT: [{rel['from']}] ({ca}) entails [{rel['to']}] ({cb}), "
                f"but {cb} < {ca}."
            )
        elif rtype == "contrary" and ca + cb > 1.0:
            errors.append(
                f"CONTRARY: [{rel['from']}] ({ca}) + [{rel['to']}] ({cb}) = {ca+cb:.2f} > 1.0."
            )
        elif rtype == "contradictory" and abs(ca + cb - 1.0) > CONTRADICTION_TOLERANCE:
            errors.append(
                f"CONTRADICTION: [{rel['from']}] ({ca}) + [{rel['to']}] ({cb}) = {ca+cb:.2f} != 1.0."
            )
    return errors


def check_math(statements: dict) -> list[str]:
    """Evaluate math expressions with SymPy."""
    errors = []
    for title, s in statements.items():
        expr_str = s.get("math")
        if not expr_str:
            continue
        try:
            result = sympy.sympify(expr_str)
            if result is sympy.true:
                pass
            elif result is sympy.false:
                errors.append(f"MATH FAIL: [{title}]: '{expr_str}' is False")
            else:
                errors.append(f"MATH EVAL: [{title}]: '{expr_str}' = {float(result.evalf()):.4f} (not boolean)")
        except Exception as e:
            errors.append(f"MATH ERROR: [{title}]: '{expr_str}' raised {e}")
    return errors


def check_graph(statements: dict, relations: list, data: dict) -> list[str]:
    """Check for cycles and isolated top-level claims."""
    G = nx.DiGraph()
    errors = []
    for title in statements:
        G.add_node(title)
    for rel in relations:
        G.add_edge(rel["from"], rel["to"], type=rel["relationType"])

    entailment_edges = [(u, v) for u, v, d in G.edges(data=True) if d["type"] == "entails"]
    for cycle in nx.simple_cycles(nx.DiGraph(entailment_edges)):
        errors.append(f"ENTAILMENT CYCLE: {' -> '.join(cycle)}")

    top_level = {t for t, ec in data.get("statements", {}).items() if ec.get("isUsedAsTopLevelStatement")}
    for title in statements:
        if G.degree(title) == 0 and title in top_level:
            errors.append(f"ISOLATED: [{title}] is a top-level statement with no relations")
    return errors


def check_pcs_credences(data: dict, statements: dict) -> tuple[list[str], list[str]]:
    """Compute conclusion credences from premises * inference strength.

    Premises get {credence: X} (trust in source).
    Conclusions get {inference: X} (reasoning strength).
    Computed: conclusion_credence = product(premise_credences) * inference.

    Writes computed credences back into statements dict for downstream propagation.
    """
    errors, notes = [], []
    for arg_name, arg in data.get("arguments", {}).items():
        pcs = arg.get("pcs", [])
        premises = [m for m in pcs if m.get("role") == "premise"]
        conclusions = [m for m in pcs if m.get("role") == "main-conclusion"]
        if not premises or not conclusions:
            continue

        premise_credences = [
            (p["title"], (p.get("data") or {}).get("credence"))
            for p in premises
            if (p.get("data") or {}).get("credence") is not None
        ]
        if not premise_credences:
            continue

        premise_product = math.prod(c for _, c in premise_credences)

        for conc in conclusions:
            conc_data = conc.get("data") or {}
            inference = conc_data.get("inference")
            hardcoded = conc_data.get("credence")

            if inference is not None:
                computed = premise_product * inference
                premise_str = " * ".join(f"{c}" for _, c in premise_credences)
                notes.append(f"  <{arg_name}>: [{conc['title']}]")
                notes.append(f"    premises: {premise_str} = {premise_product:.3f}")
                notes.append(f"    inference: {inference}")
                notes.append(f"    computed credence: {premise_product:.3f} * {inference} = {computed:.2f}")
                if conc["title"] in statements:
                    statements[conc["title"]]["credence"] = round(computed, 4)
                if inference > 1.0:
                    errors.append(f"PCS: <{arg_name}> [{conc['title']}] inference={inference} > 1.0")
            elif hardcoded is not None:
                if hardcoded > premise_product:
                    errors.append(
                        f"PCS: <{arg_name}> [{conc['title']}] credence={hardcoded} > "
                        f"product of premises ({premise_product:.3f})"
                    )
                implied = hardcoded / premise_product
                premise_str = " * ".join(f"{c}" for _, c in premise_credences)
                notes.append(f"  <{arg_name}>: [{conc['title']}] credence={hardcoded}")
                notes.append(f"    premises: {premise_str} = {premise_product:.3f}")
                notes.append(f"    implied inference: {hardcoded} / {premise_product:.3f} = {implied:.2f}")
    return errors, notes


def crux_analysis(statements: dict, relations: list) -> list[str]:
    """Identify cruxes: statements whose credence most affects downstream."""
    G = nx.DiGraph()
    for rel in relations:
        if rel["relationType"] == "entails":
            G.add_edge(rel["from"], rel["to"])
    notes = []
    for title, s in statements.items():
        if s.get("credence") is None or title not in G:
            continue
        downstream = len(nx.descendants(G, title))
        if downstream > 0:
            notes.append(
                f"CRUX: [{title}] (credence={s['credence']:.2f}) "
                f"affects {downstream} downstream statement(s)."
            )
    return notes


def propagate_credences(statements: dict, relations: list, data: dict) -> dict[str, dict]:
    """Propagate credences to compute implied credence for top-level claims.

    Uses log-odds summation (Bayesian updating) to combine evidence:
    - Supporting arguments (entails): add log-odds
    - Contrary arguments: subtract log-odds
    - Result is converted back to probability via sigmoid

    log_odds(c) = log(c / (1-c))
    sigmoid(L) = 1 / (1 + exp(-L))
    """
    targets: dict[str, dict] = {}
    for rel in relations:
        from_c = statements.get(rel["from"], {}).get("credence")
        if from_c is None:
            continue
        to = rel["to"]
        if to not in targets:
            targets[to] = {"via_entail": [], "via_contrary": []}
        rtype = rel["relationType"]
        if rtype == "entails":
            targets[to]["via_entail"].append((rel["from"], from_c))
        elif rtype == "contrary":
            targets[to]["via_contrary"].append((rel["from"], from_c))

    for t in targets.values():
        # Start from uniform prior (0 log-odds = 50%)
        log_odds = 0.0
        for name, c in t["via_entail"]:
            c_clamped = max(0.001, min(0.999, c))
            log_odds += math.log(c_clamped / (1 - c_clamped))
        for name, c in t["via_contrary"]:
            c_clamped = max(0.001, min(0.999, c))
            log_odds -= math.log(c_clamped / (1 - c_clamped))
        t["log_odds"] = log_odds
        t["implied"] = 1.0 / (1.0 + math.exp(-log_odds))
    return targets


def format_propagation(targets: dict[str, dict]) -> list[str]:
    """Format propagation results for display."""
    lines = []
    for title, t in targets.items():
        implied = t.get("implied")
        if implied is None:
            continue
        log_odds = t.get("log_odds", 0.0)
        lines.append(f"  [{title}] implied credence: {implied:.2f} ({log_odds:+.2f} log-odds)")
        for name, c in t["via_entail"]:
            lo = math.log(max(0.001, c) / max(0.001, 1 - c))
            lines.append(f"    + [{name}] ({c:.2f}, {lo:+.2f} log-odds)")
        for name, c in t["via_contrary"]:
            lo = math.log(max(0.001, c) / max(0.001, 1 - c))
            lines.append(f"    - [{name}] ({c:.2f}, {lo:+.2f} log-odds)")
    return lines


# --- Verification runner ---

def verify(data: dict) -> tuple[int, dict, list]:
    """Run all checks. Returns (exit_code, statements, relations).
    Prints results to stdout. Mutates statements with computed credences.
    """
    statements = extract_statements(data)
    relations = extract_relations(data)

    all_errors = []
    all_errors += check_credence_consistency(statements, relations)
    all_errors += check_math(statements)
    all_errors += check_graph(statements, relations, data)

    # PCS must run before propagation -- computes conclusion credences
    pcs_errors, pcs_notes = check_pcs_credences(data, statements)
    all_errors += pcs_errors
    crux_notes = crux_analysis(statements, relations)

    if all_errors:
        print(f"\n{len(all_errors)} issues found:\n")
        for e in all_errors:
            print(f"  {e}")
    else:
        print("All checks passed.")

    if crux_notes:
        print(f"\nCrux analysis:")
        for n in crux_notes:
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

    n_credences = sum(1 for s in statements.values() if s.get("credence") is not None)
    print(f"\nSummary: {len(statements)} statements, {len(relations)} relations, {n_credences} with credences")

    return (1 if all_errors else 0), statements, relations


# --- HTML rendering ---

def credence_color(c: float) -> str:
    hue = c * 120
    return f"hsl({hue:.0f}, 70%, 45%)"


def credence_bg(c: float) -> str:
    hue = c * 120
    return f"hsl({hue:.0f}, 60%, 92%)"


def render_credence(c: float, label: str = "", reason: str = "") -> str:
    """Colored badge with optional tooltip reason."""
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
            # argdown range stop is inclusive, +1 for python slice
            name = text[r["start"]:r["stop"] + 1] if "start" in r and "stop" in r else None
            return name, r.get("url")
    return None, None


def extract_quote(text: str) -> str | None:
    """Extract blockquote content from premise text."""
    for marker in ('>"', "> "):
        idx = text.find(marker)
        if idx >= 0:
            return text[idx + 1:].strip().strip('"')
    return None


def conclusion_relation(conc_title: str, relations: list[dict]) -> tuple[str, str] | None:
    for rel in relations:
        if rel["from"] == conc_title:
            return rel["relationType"], rel["to"]
    return None


def render_argument(arg_name: str, arg: dict, statements: dict, relations: list[dict]) -> str:
    pcs = arg.get("pcs", [])
    if not pcs:
        return ""

    premises = [m for m in pcs if m.get("role") == "premise"]
    conclusions = [m for m in pcs if m.get("role") == "main-conclusion"]

    # Determine relation type from conclusion
    arg_type, rel_target = None, None
    for conc in conclusions:
        rel = conclusion_relation(conc.get("title", ""), relations)
        if rel:
            arg_type, rel_target = rel
            break

    border_color = {"entails": "#2d9a2d", "contrary": "#d9534f"}.get(arg_type, "#e0e0e0")
    rel_label = {"entails": "supports", "contrary": "challenges", "contradictory": "contradicts"}.get(arg_type)

    lines = [f'<div class="argument" style="border-left: 4px solid {border_color};">']
    lines.append(f'<h3>{escape(arg_name)}</h3>')

    # Premises: quote-first layout with ACE-inspired labels
    for i, p in enumerate(premises, 1):
        data = p.get("data") or {}
        credence = data.get("credence")
        reason = data.get("reason", "")
        title = p.get("title", "?")
        link_name, link_url = extract_link(p)
        tags = p.get("tags", [])
        is_assumption = "assumption" in tags

        lines.append('<div class="premise">')
        lines.append(f'<span class="premise-nr">({i})</span> ')
        if is_assumption:
            lines.append('<span class="label-assumption">If</span> ')
        lines.append(f'<strong>{escape(title)}</strong>')

        # Quote first (the evidence)
        quote = extract_quote(p.get("text", ""))
        if quote:
            lines.append(f'<blockquote>"{escape(quote)}"</blockquote>')

        # Source + credence on one line
        source_parts = []
        if link_url:
            display = escape(link_name) if link_name else escape(link_url)
            source_parts.append(f'<a href="{escape(link_url)}" target="_blank">{display}</a>')
        if credence is not None:
            source_parts.append(render_credence(credence, "credence", reason))
        if source_parts:
            lines.append(f'<div class="source-line">{" ".join(source_parts)}</div>')
        elif credence is not None:
            lines.append(f'<div class="source-line">{render_credence(credence, "credence", reason)}</div>')
        lines.append('</div>')

    # Inference step text + inference strength (from expanded inference rules on the conclusion)
    for conc in conclusions:
        inf_data = conc.get("inference", {})
        conc_data = conc.get("data") or {}
        inference_strength = conc_data.get("inference")
        reason = conc_data.get("reason", "")
        for rule in inf_data.get("inferenceRules", []):
            parts = [f'<div class="inference-step">\u2234 {escape(rule)}']
            if inference_strength is not None:
                parts.append(f' {render_credence(inference_strength, "inference", reason)}')
            parts.append('</div>')
            lines.append("".join(parts))

    # Conclusion with explicit math
    for conc in conclusions:
        data = conc.get("data") or {}
        title = conc.get("title", "?")
        inference = data.get("inference")
        computed = statements.get(title, {}).get("credence")

        lines.append('<div class="conclusion">')
        lines.append(f'<span class="label-conclusion">Then</span> ')
        lines.append(f'<strong>{escape(title)}</strong>: {escape(conc.get("text", ""))}')
        # Show explicit math: premise_credences * inference = computed
        if computed is not None:
            premise_vals = [(p.get("title", "?"), (p.get("data") or {}).get("credence"))
                           for p in premises if (p.get("data") or {}).get("credence") is not None]
            if premise_vals and inference is not None:
                parts_str = " \u00d7 ".join(f"{c:.0%}" for _, c in premise_vals)
                product = math.prod(c for _, c in premise_vals)
                lines.append(
                    f'<br><span class="math">{parts_str} \u00d7 {inference:.0%}'
                    f' = {render_credence(computed, "computed credence")}</span>'
                )
            else:
                lines.append(f'<br>computed: {render_credence(computed, "computed credence")}')
        if rel_label and rel_target:
            symbol = {"entails": "\u2191", "contrary": "\u2193", "contradictory": "\u2194"}.get(arg_type, "?")
            lines.append(
                f'<span class="relation-indicator" style="color:{border_color};" '
                f'title="{rel_label}"> {symbol} {rel_label} {escape(rel_target)}</span>'
            )
        lines.append('</div>')

    lines.append('</div>')
    return "\n".join(lines)


def render_html(data: dict, statements: dict, relations: list, argdown_source: str | None = None) -> str:
    """Render full HTML page. Takes pre-computed statements (with credences) and relations."""
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

    targets = propagate_credences(statements, relations, data)
    bottom_lines = [(t, targets[t].get("implied"), targets[t]) for t in targets if targets[t].get("implied") is not None]
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
    max-width: 42em; margin: 2em auto; padding: 0 1em;
    line-height: 1.6; color: #333;
}}
h1 {{ color: #1a1a1a; font-size: 1.4em; }}
h2 {{ color: #555; font-size: 1.1em; border-bottom: 1px solid #ddd; padding-bottom: 0.3em; }}
h3 {{ color: #0582ca; font-size: 1em; margin-bottom: 0.5em; }}
.bottom-line {{
    background: #f8f9fa; border-left: 4px solid #0582ca;
    padding: 1em 1.5em; margin-bottom: 2em; font-size: 1.1em;
}}
.bottom-line .claim {{ font-weight: 600; }}
.bottom-line .via {{ font-size: 0.85em; color: #666; margin-top: 0.3em; }}
.argument {{
    margin-bottom: 2em; padding: 1em;
    border: 1px solid #e0e0e0; border-radius: 6px;
}}
.premise {{
    margin-bottom: 0.8em; padding-left: 2em;
}}
.premise-nr {{ color: #0582ca; font-weight: 600; }}
.source-line {{ padding-left: 2em; margin-top: 0.2em; font-size: 0.9em; }}
.label-assumption {{ color: #e68a00; font-weight: 600; font-style: italic; }}
.label-conclusion {{ color: #0582ca; font-weight: 600; font-style: italic; }}
.tag {{ color: #66a61e; font-size: 0.85em; }}
blockquote {{
    margin: 0.5em 0 0.5em 2.5em;
    padding: 0.4em 0.8em 0.4em 1em;
    border-left: 3px solid #ccc;
    color: #555; font-style: italic; font-size: 0.9em;
}}
.inference-step {{
    border-top: 2px solid #0582ca; border-bottom: 2px solid #0582ca;
    padding: 0.5em 1em; margin: 0.8em 0;
    color: #0582ca; font-size: 0.9em; font-style: italic;
}}
.conclusion {{ padding: 0.5em; background: #f8f9fa; border-radius: 4px; }}
.math {{ font-size: 0.9em; color: #555; font-variant-numeric: tabular-nums; }}
.relation-indicator {{ font-size: 0.85em; font-weight: 600; margin-left: 0.5em; }}
a {{ color: #0582ca; }}
.credence {{ font-size: 0.85em; font-variant-numeric: tabular-nums; }}
.section-label {{ color: #888; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.05em; }}
details.source-code {{ margin-top: 2em; border-top: 1px solid #ddd; padding-top: 1em; }}
details.source-code summary {{ cursor: pointer; color: #888; font-size: 0.9em; }}
details.source-code pre {{
    background: #f6f8fa; padding: 1em; border-radius: 4px;
    overflow-x: auto; font-size: 0.8em; line-height: 1.4;
}}
</style>
</head>
<body>
<h1>{escape(title_text or title_name)}</h1>
"""

    if bottom_lines:
        html += '<div class="bottom-line">\n<span class="section-label">Bottom line</span>\n'
        for t_title, implied, t in bottom_lines:
            log_odds = t.get("log_odds", 0.0)
            html += f'<div class="claim">{escape(t_title)}: {render_credence(implied, "implied credence")} <span style="font-size:0.8em;color:#888">({log_odds:+.1f} log-odds)</span></div>\n'
            for name, c in t["via_entail"]:
                lo = math.log(max(0.001, c) / max(0.001, 1 - c))
                html += f'<div class="via">\u2191 {escape(name)} ({c:.0%}, {lo:+.1f})</div>\n'
            for name, c in t["via_contrary"]:
                lo = math.log(max(0.001, c) / max(0.001, 1 - c))
                html += f'<div class="via">\u2193 {escape(name)} ({c:.0%}, {lo:+.1f})</div>\n'
        html += '</div>\n'

    # Arguments grouped by section
    sections = {}
    for arg_name, arg in arguments.items():
        section = next((m.get("section") for m in arg.get("members", []) if m.get("section")), None)
        sections.setdefault(section, []).append((arg_name, arg))
    section_titles = {s.get("id", ""): s.get("title", "") for s in data.get("sections", [])}

    for section_id, args in sections.items():
        section_title = section_titles.get(section_id, "")
        if section_title:
            html += f'<h2>{escape(section_title)}</h2>\n'
        for arg_name, arg in args:
            html += render_argument(arg_name, arg, statements, relations)

    if argdown_source:
        html += '<details class="source-code">\n<summary>Raw argdown source</summary>\n'
        html += f'<pre><code>{escape(argdown_source)}</code></pre>\n</details>\n'

    html += '</body>\n</html>'
    return html


# --- Main ---

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if path and Path(path).exists():
        data = json.loads(Path(path).read_text())
    else:
        data = json.load(sys.stdin)

    # Verify (prints to stdout, mutates statements with computed credences)
    exit_code, statements, relations = verify(data)

    # Find matching .argdown source for expandable raw view
    argdown_source = None
    if path:
        argdown_path = Path(path).with_suffix(".argdown")
        if argdown_path.exists():
            argdown_source = argdown_path.read_text()

    # Render
    output = sys.argv[2] if len(sys.argv) > 2 else "example_verified.html"
    Path(output).write_text(render_html(data, statements, relations, argdown_source))
    print(f"\nRendered to {output}")

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
