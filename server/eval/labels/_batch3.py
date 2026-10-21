"""Hand labels (by the build assistant, Claude) for new impact links in the
"after" runs (current pipeline, eval/runs_after), part 1. Links whose key also
appears in the "before" runs keep their earlier label. Indices refer to
impact_sheet_after.json at the time of labelling; label_apply.py stores them
by stable key."""

SHEET = "impact_sheet_after"
C, P, W = "correct", "partial", "wrong"
L = {
    1: (P, "Castro is a former leader; 'political leadership of Cuba' overstates"),
    2: (C, "plausible, rightly speculative"),
    5: (C, "basis: one referendum is on separation"),
    6: (C, "plausible, rightly speculative"),
    12: (P, "the agreement affects Andorra; the Commission is a party, not the cause"),
    13: (P, "the agreement affects San Marino; the Commission is a party, not the cause"),
    15: (P, "a procedural step (asking consent), not an effect"),
    16: (C, "basis: the deals aim at certainty for public authorities"),
    17: (C, "stated aim, rightly cautious"),
    18: (C, "stated aim, rightly cautious"),
    19: (P, "vague endpoint"),
    20: (P, "the reasoning says there is little effect, yet an affects link is drawn"),
    24: (C, "basis: migrants were killed"),
    25: (W, "backwards: the capsizing caused the deaths"),
    26: (P, "location, not an affected party"),
    31: (P, "location, not an affected party"),
    32: (C, "plausible, rightly speculative"),
    33: (C, "plausible, rightly speculative"),
    34: (C, "plausible, rightly speculative"),
    35: (C, "plausible, rightly speculative"),
    36: (C, "plausible, rightly speculative"),
    40: (C, "the programme aims to cut cases"),
    41: (C, "plausible, rightly speculative"),
    43: (C, "the party's leader is detained"),
    44: (W, "backwards: the police carried out the detention"),
    45: (C, "plausible, rightly speculative"),
    46: (C, "plausible, rightly speculative"),
    47: (C, "plausible, rightly speculative"),
    48: (C, "plausible, rightly speculative"),
    57: (W, "Carney only commented; the award does not affect him"),
    58: (P, "the award, not Carney's comment, shapes the reputation"),
    59: (P, "muddled: praise by the committee for the Academy's prestige"),
    63: (C, "plausible, rightly speculative"),
    64: (C, "plausible, rightly speculative"),
}
