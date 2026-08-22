-- Keep opportunistic one-time challenge cleanup indexed by expiry.
CREATE INDEX idx_used_challenges_exp ON used_challenges(exp);
