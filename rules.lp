% rules.lp -- ASP verification rules for vargdown
% All credences/inferences are integers in basis points (bps): 7000 = 0.70
% Facts are emitted by compile_asp.mjs from argdown JSON.
% This file contains ONLY rules; facts come from the compiled program.

% ============================================================
% Range checks
% ============================================================
violation(range_low, A, C) :- premise(A, _, C, V), V < 0.
violation(range_high, A, C) :- premise(A, _, C, V), V > 10000.
violation(inference_range_low, A, C) :- inference(A, C, V), V < 0.
violation(inference_range_high, A, C) :- inference(A, C, V), V > 10000.

% ============================================================
% Missing required fields
% ============================================================
violation(missing_reason, A, C) :- premise(A, _, C, _), not has_reason(A, C).
violation(missing_inference_reason, A, C) :- inference(A, C, _), not has_inference_reason(A, C).

% ============================================================
% Observation requirements
% ============================================================
violation(missing_source, C) :- tag(C, observation), not has_source(C).
violation(missing_quote, C) :- tag(C, observation), not has_quote(C).

% ============================================================
% Entails targets must not have hardcoded credence
% (thesis credence should be computed, not stated)
% ============================================================
violation(top_level_credence, C) :- entails(_, C), hardcoded_credence(C).

% ============================================================
% Conclusion uses credence instead of inference
% ============================================================
violation(credence_on_conclusion, A, C) :- conclusion_has_credence(A, C).

% ============================================================
% Premise incorrectly has inference
% ============================================================
violation(inference_on_premise, A, C) :- premise_has_inference(A, C).

% ============================================================
% Entailment monotonicity: P(B) >= P(A)
% ============================================================
violation(entailment, A, B) :- entails(A, B), computed(A, CA), computed(B, CB), CB < CA.

% ============================================================
% Contrary constraint: P(A) + P(B) <= 1
% ============================================================
violation(contrary_sum, A, B) :-
  contrary(A, B), computed(A, CA), computed(B, CB), CA + CB > 10000, A != B.

% ============================================================
% Contradiction (mutual contrary): P(A) + P(B) ~= 1 (within 5% = 500 bps)
% Symmetry: if contrary(A,B) exists, also treat contrary(B,A) as true
% ============================================================
contrary_sym(A, B) :- contrary(A, B).
contrary_sym(A, B) :- contrary(B, A).

violation(contradiction_high, A, B) :-
  contrary_sym(A, B), contrary_sym(B, A),
  computed(A, CA), computed(B, CB),
  CA + CB - 10000 > 500, A < B.

violation(contradiction_low, A, B) :-
  contrary_sym(A, B), contrary_sym(B, A),
  computed(A, CA), computed(B, CB),
  10000 - CA - CB > 500, A < B.

% ============================================================
% Entailment cycle detection (transitive reachability)
% ============================================================
reaches(A, B) :- entails(A, B).
reaches(A, C) :- reaches(A, B), entails(B, C).
violation(cycle, A) :- reaches(A, A).

% ============================================================
% Isolated top-level claims (no relations at all)
% ============================================================
has_relation(C) :- entails(C, _).
has_relation(C) :- entails(_, C).
has_relation(C) :- contrary(C, _).
has_relation(C) :- contrary(_, C).
has_relation(C) :- premise(_, _, C, _).
has_relation(C) :- pcs_member(_, C).
violation(isolated, C) :- top_claim(C), not has_relation(C).

% ============================================================
% Output
% ============================================================
#show violation/2.
#show violation/3.
