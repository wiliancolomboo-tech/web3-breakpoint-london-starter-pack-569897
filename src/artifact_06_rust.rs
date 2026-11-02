use anchor_lang::prelude::*;

#[account]
pub struct EventRegistry {
    /// Authority who can freeze the event or withdraw treasury surplus.
    pub authority: Pubkey,
    /// Unique 32-byte identifier for the event (e.g. SHA256 of "BREAKPOINT_LONDON_2024").
    pub event_id: [u8; 32],
    /// Human readable name stored up to 64 bytes.
    pub name: String,
    /// Lamport payout distributed per claim.
    pub perk_amount: u64,
    /// Total claims executed so far.
    pub total_claims: u64,
    /// Maximum number of claims allowed.
    pub max_claims: u64,
    /// Emergency killswitch.
    pub is_active: bool,
    /// PDA bump seed.
    pub bump: u8,
    /// Treasury PDA bump seed.
    pub vault_bump: u8,
}

impl EventRegistry {
    // 8 (discriminator) + 32 + 32 + (4 + 64) + 8 + 8 + 8 + 1 + 1 + 1 = 159 bytes
    pub const LEN: usize = 8 + 32 + 32 + 68 + 8 + 8 + 8 + 1 + 1 + 1;
}