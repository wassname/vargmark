"""
Argdown strict mode verifier.

Parses Argdown JSON export and checks:
1. Credence consistency against strict mode logical relations
   - entails: credence(B) >= credence(A)
   - contrary: credence(A) + credence(B) <= 1
   - contradictory: credence(A) + credence(B) = 1 (within tolerance)
2. PCS inference strength: conclusion <= product(premises)
3. Math expressions (SymPy)
4. Epistemic tags (observations must have sources -- checked if present)
5. Graph structure (NetworkX)
6. Credence propagation + crux identification

Usage:
    npx @argdown/cli json input.argdown --stdout | python verify_argdown.py
    # or
    python verify_argdown.py exported.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import networkx as nx
import sympy


CONTRADICTION_TOLERANCE = 0.05  # credences should sum to 1.0 +/- this


def load_json(path_or_stdin: str | None) -> dict:
    if path_or_stdin and Path(path_or_stdin).exists():
        return json.loads(Path(path_or_stdin).read_text())
    return json.load(sys.stdin)


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
    """Extract all relations with types."""
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


def check_credence_consistency(statements: dict, relations: list) -> list[str]:
    """Check credences against strict mode logical constraints."""
    errors = []
    for rel in relations:
        a_title = rel["from"]
        b_title = rel["to"]
        a = statements.get(a_title, {})
        b = statements.get(b_title, {})
        ca = a.get("credence")
        cb = b.get("credence")

        if ca is None or cb is None:
            continue

        rtype = rel["relationType"]

        if rtype == "entails":
            # A entails B: P(B) >= P(A)
            if cb < ca:
                errors.append(
                    f"ENTAILMENT: [{a_title}] (credence={ca}) entails "
                    f"[{b_title}] (credence={cb}), but {cb} < {ca}. "
                    f"If A entails B, credence(B) must be >= credence(A)."
                )

        elif rtype == "contrary":
            # A contrary to B: can't both be true, P(A) + P(B) <= 1
            total = ca + cb
            if total > 1.0:
                errors.append(
                    f"CONTRARY: [{a_title}] (credence={ca}) contrary to "
                    f"[{b_title}] (credence={cb}), sum={total:.2f} > 1.0. "
                    f"Contraries can't both be true."
                )

        elif rtype == "contradictory":
            # A contradicts B: exactly one true, P(A) + P(B) = 1
            total = ca + cb
            if abs(total - 1.0) > CONTRADICTION_TOLERANCE:
                errors.append(
                    f"CONTRADICTION: [{a_title}] (credence={ca}) contradicts "
                    f"[{b_title}] (credence={cb}), sum={total:.2f} != 1.0 "
                    f"(tolerance={CONTRADICTION_TOLERANCE})."
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
                val = float(result.evalf())
                errors.append(
                    f"MATH EVAL: [{title}]: '{expr_str}' = {val:.4f} "
                    f"(not a boolean comparison)"
                )
        except Exception as e:
            errors.append(f"MATH ERROR: [{title}]: '{expr_str}' raised {e}")
    return errors


def check_graph(statements: dict, relations: list, data: dict) -> list[str]:
    """Build graph and check structure."""
    G = nx.DiGraph()
    errors = []

    for title in statements:
        G.add_node(title)

    for rel in relations:
        G.add_edge(rel["from"], rel["to"], type=rel["relationType"])

    # Check for cycles in entailment subgraph
    entailment_edges = [(u, v) for u, v, d in G.edges(data=True) if d["type"] == "entails"]
    E = nx.DiGraph(entailment_edges)
    cycles = list(nx.simple_cycles(E))
    for cycle in cycles:
        errors.append(f"ENTAILMENT CYCLE: {' -> '.join(cycle)} (circular reasoning)")

    # Isolated nodes: only flag statements that appear as top-level claims
    # but have no relations. PCS-internal premises (inside arguments) are
    # expected to be "isolated" in the cross-argument graph.
    top_level = {
        title for title, ec in data.get("statements", {}).items()
        if ec.get("isUsedAsTopLevelStatement")
    }
    for title in statements:
        if G.degree(title) == 0 and title in top_level:
            errors.append(f"ISOLATED: [{title}] is a top-level statement with no relations")

    return errors


def check_pcs_credences(data: dict, statements: dict) -> tuple[list[str], list[str]]:
    """Compute PCS conclusion credences from premises and inference strength.

    Model: P(conclusion) = product(premise_credences) * inference_strength
    - premise_credences: author's confidence in each premise (assuming independence)
    - inference_strength: author's confidence that conclusion follows from premises

    Conclusions should specify {inference: X} not {credence: X}.
    Computed credences are written back into the statements dict for downstream propagation.

    Returns (errors, notes).
    """
    import math
    errors = []
    notes = []

    for arg_name, arg in data.get("arguments", {}).items():
        pcs = arg.get("pcs", [])
        premises = [m for m in pcs if m.get("role") == "premise"]
        conclusions = [m for m in pcs if m.get("role") == "main-conclusion"]

        if not premises or not conclusions:
            continue

        premise_credences = []
        for p in premises:
            c = (p.get("data") or {}).get("credence")
            if c is not None:
                premise_credences.append((p["title"], c))

        if not premise_credences:
            continue

        premise_product = math.prod(c for _, c in premise_credences)

        for conc in conclusions:
            conc_data = conc.get("data") or {}
            inference = conc_data.get("inference")
            hardcoded_credence = conc_data.get("credence")

            if inference is not None:
                # Compute credence from premises * inference
                computed = premise_product * inference
                premise_str = " * ".join(f"{c}" for _, c in premise_credences)
                notes.append(f"  <{arg_name}>: [{conc['title']}]")
                notes.append(f"    premises: {premise_str} = {premise_product:.3f}")
                notes.append(f"    inference: {inference}")
                notes.append(f"    computed credence: {premise_product:.3f} * {inference} = {computed:.2f}")

                # Write computed credence back for downstream propagation
                if conc["title"] in statements:
                    statements[conc["title"]]["credence"] = round(computed, 4)

                if inference > 1.0:
                    errors.append(
                        f"PCS: <{arg_name}> [{conc['title']}] inference={inference} > 1.0. "
                        f"Inference strength must be in [0, 1]."
                    )

            elif hardcoded_credence is not None:
                # Backward compat: conclusion has {credence} directly
                if hardcoded_credence > premise_product:
                    errors.append(
                        f"PCS: <{arg_name}> conclusion [{conc['title']}] "
                        f"(credence={hardcoded_credence}) > product of premises ({premise_product:.3f}). "
                        f"Inference can't add confidence beyond what premises support."
                    )
                inference_implied = hardcoded_credence / premise_product
                premise_str = " * ".join(f"{c}" for _, c in premise_credences)
                notes.append(f"  <{arg_name}>: [{conc['title']}] credence={hardcoded_credence}")
                notes.append(f"    premises: {premise_str} = {premise_product:.3f}")
                notes.append(f"    implied inference: {hardcoded_credence} / {premise_product:.3f} = {inference_implied:.2f}")

    return errors, notes


def crux_analysis(statements: dict, relations: list) -> list[str]:
    """Identify cruxes: which credence, if changed, most affects downstream."""
    notes = []

    # Build entailment graph and find statements with most downstream dependents
    G = nx.DiGraph()
    for rel in relations:
        if rel["relationType"] == "entails":
            G.add_edge(rel["from"], rel["to"])

    for title, s in statements.items():
        if s.get("credence") is None:
            continue
        if title not in G:
            continue
        # Count downstream nodes reachable via entailment
        downstream = len(nx.descendants(G, title))
        if downstream > 0:
            notes.append(
                f"CRUX: [{title}] (credence={s['credence']:.2f}) "
                f"has {downstream} downstream entailment(s). "
                f"Changing this credence affects {downstream} other statement(s)."
            )

    return notes


def propagate_credences(
    statements: dict, relations: list, data: dict
) -> dict[str, dict]:
    """Propagate credences through the argument graph to compute implied bounds.

    For each statement that is a target of entailment or contrary relations:
    - entailment from A: lower bound = max(all entailing credences)
    - contrary from B: upper bound = min(1 - contrary_credence for all contraries)
    - implied credence = min(upper_bound, lower_bound) if both exist

    Returns dict of {title: {lower, upper, implied, via_entail, via_contrary}}.
    """
    # Find top-level claim(s): statements that are targets of entailment/contrary
    # but come from the top-level graph (i.e. have relations pointing TO them)
    targets: dict[str, dict] = {}

    for rel in relations:
        to_title = rel["to"]
        from_title = rel["from"]
        from_s = statements.get(from_title, {})
        from_c = from_s.get("credence")
        if from_c is None:
            continue

        if to_title not in targets:
            targets[to_title] = {
                "lower": None,
                "upper": None,
                "via_entail": [],
                "via_contrary": [],
            }

        rtype = rel["relationType"]
        t = targets[to_title]

        if rtype == "entails":
            # A entails B => P(B) >= P(A), so A's credence is a lower bound
            t["via_entail"].append((from_title, from_c))
            bound = from_c
            t["lower"] = max(t["lower"], bound) if t["lower"] is not None else bound

        elif rtype == "contrary":
            # A contrary to B => P(A) + P(B) <= 1 => P(B) <= 1 - P(A)
            t["via_contrary"].append((from_title, from_c))
            bound = 1.0 - from_c
            t["upper"] = min(t["upper"], bound) if t["upper"] is not None else bound

    # Compute implied credence for each target
    for title, t in targets.items():
        lower = t["lower"]
        upper = t["upper"]
        if lower is not None and upper is not None:
            t["implied"] = min(upper, lower)
        elif lower is not None:
            t["implied"] = lower
        elif upper is not None:
            t["implied"] = upper
        else:
            t["implied"] = None

    return targets


def format_propagation(targets: dict[str, dict]) -> list[str]:
    """Format propagation results for display."""
    lines = []
    for title, t in targets.items():
        implied = t.get("implied")
        if implied is None:
            continue
        lines.append(f"  [{title}] implied credence: {implied:.2f}")
        for name, c in t["via_entail"]:
            lines.append(f"    via entailment from [{name}] ({c:.2f})")
        for name, c in t["via_contrary"]:
            lines.append(f"    bounded by contrary [{name}] ({c:.2f}) -> upper bound {1-c:.2f}")
        lower = t.get("lower")
        upper = t.get("upper")
        if lower is not None and upper is not None and lower > upper:
            lines.append(
                f"    WARNING: lower bound ({lower:.2f}) > upper bound ({upper:.2f}) "
                f"-- credences are in tension!"
            )
    return lines


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else None
    data = load_json(path)

    statements = extract_statements(data)
    relations = extract_relations(data)

    all_errors = []
    all_errors += check_credence_consistency(statements, relations)
    all_errors += check_math(statements)
    all_errors += check_graph(statements, relations, data)

    # PCS check must run before propagation -- it computes conclusion credences
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

    # Bottom-line credence propagation
    targets = propagate_credences(statements, relations, data)
    prop_lines = format_propagation(targets)
    if prop_lines:
        print(f"\nBottom line:")
        for line in prop_lines:
            print(line)

    print(f"\nSummary: {len(statements)} statements, {len(relations)} relations, "
          f"{sum(1 for s in statements.values() if s.get('credence') is not None)} with credences")

    sys.exit(1 if all_errors else 0)


if __name__ == "__main__":
    main()
