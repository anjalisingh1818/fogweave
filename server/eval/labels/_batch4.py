"""Hand labels (by the build assistant, Claude) for new impact links in the
"after" runs (current pipeline, eval/runs_after), part 2. Indices refer to
impact_sheet_after.json (all 30 runs) at the time of labelling; label_apply.py
stores them by stable key."""

SHEET = "impact_sheet_after"
C, P, W = "correct", "partial", "wrong"
L = {
    # WFP Gaza
    1: (C, "basis: assistance to 500,000 people ends"),
    2: (C, "well grounded, labelled cautiously"),
    3: (C, "basis: about $450 million needed"),
    4: (C, "plausible, rightly speculative"),
    # Abyei
    7: (P, "vague endpoint ('people')"),
    8: (P, "location restated as an effect"),
    9: (C, "plausible, rightly speculative"),
    10: (P, "vague endpoint; the strike, not Abyei, is the cause"),
    # Guadalajara
    15: (W, "backwards: the shortages cause the protest"),
    16: (C, "follows from the governor's attribution"),
    17: (P, "violence happened during the protest; 'affects violence' is odd"),
    18: (C, "the entrances of the Congress were set on fire"),
    # Bank of England
    21: (C, "basis: the designs help stop counterfeiting"),
    22: (C, "plausible, rightly speculative"),
    23: (W, "the Royal Mint does not depend on the Bank; restates 'involves'"),
    24: (C, "plausible, rightly speculative"),
    25: (P, "odd effect: notes are issued, not sold"),
    26: (C, "plausible and clearly weaker"),
    # Nariño mine
    33: (W, "part_of restated as affects"),
    34: (P, "location restated as an effect"),
    35: (C, "plausible, rightly speculative"),
    36: (C, "plausible, rightly speculative"),
    # Nobel economics
    44: (W, "the Academy awards the prize; it is not affected"),
    45: (W, "location restated as an effect"),
    46: (C, "the laureates are affected by the award"),
    47: (C, "the laureates are affected by the award"),
    48: (P, "Hall made the models; 'affects' is loose"),
    49: (P, "Woodford made the models; 'affects' is loose"),
    # leap hour
    72: (C, "the vote adopts the leap hour"),
    73: (C, "the vote retires the leap second"),
    74: (C, "well grounded, labelled cautiously"),
    75: (C, "Russia's concern for GLONASS is reported"),
    76: (C, "plausible, rightly speculative"),
    # West Bank arrests
    79: (W, "the police made the arrests; actor restated as affected"),
    80: (P, "location restated as an effect"),
    81: (P, "plausible but not stated"),
    82: (C, "plausible, rightly speculative"),
    83: (C, "plausible and clearly weaker"),
    # Ensenada sentencing
    90: (P, "location restated as an effect"),
    91: (W, "the victims are dead; the sentence does not affect them"),
    92: (W, "the victim is dead; the sentence does not affect them"),
    93: (W, "the event does not depend on the state it happened in"),
    # Khartoum strike
    98: (P, "location restated as an effect"),
    99: (W, "part_of restated as depends_on"),
    # ECB / UniCredit / Commerzbank
    110: (C, "the ECB authorised UniCredit"),
    111: (C, "the authorisation concerns Commerzbank"),
    112: (C, "basis: stake above 30% allowed"),
    113: (C, "plausible, rightly speculative"),
    # Taiwan coast guard
    128: (W, "the coast guard is the actor"),
    129: (C, "the vessels were driven away (could have been inferred)"),
    130: (P, "location restated as an effect"),
    131: (P, "the vessels entered the waters; the driving-away does not affect them"),
    132: (P, "basis is the July deployment, not this incident"),
    133: (C, "the Chinese coast guard vessels were driven away"),
    # Mpumalanga rescue
    145: (P, "only fourteen needed treatment"),
    146: (P, "linked to, not dependent on, the investigation"),
    # Mackenzie conviction
    153: (P, "weak: the case is about the deaths, not the forest"),
    154: (P, "location restated as an effect"),
    155: (W, "the victims are dead; the conviction does not affect them"),
    # oldest shipwreck
    167: (P, "trivial"),
    168: (W, "the amphorae are part of the wreck, not affected by it"),
    171: (C, "plausible, rightly speculative"),
    172: (W, "the minister is not an academic; he only commented"),
    # Amazon deforestation
    177: (P, "tautological"),
    178: (W, "depends on itself"),
    # Canada v England rugby
    196: (C, "England lost the match"),
    197: (C, "Canada won the match"),
    198: (P, "loose: the match is part of the series"),
    199: (W, "backwards: the player's try decided the match"),
    200: (W, "a team does not depend on its run"),
    201: (W, "the Red Roses are the England team"),
    202: (C, "plausible, rightly speculative"),
    # Kenya Ebola
    210: (C, "plausible, rightly speculative"),
    211: (C, "plausible, rightly speculative"),
    212: (P, "plausible, but the basis does not mention the agencies"),
    213: (C, "plausible, rightly speculative"),
    214: (C, "more cases need isolation capacity"),
    # Panthers
    218: (P, "the streak happens in the NHL; 'affects' is loose"),
    219: (P, "the streak is in the sport; 'affects' is loose"),
}
