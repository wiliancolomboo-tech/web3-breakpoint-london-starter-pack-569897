use anchor_lang::prelude::*;

#[account]
pub struct ClaimRecord {
    /// The attendee account address.
    pub attendee: Pubkey,
    /// The event ID for which this claim applies.
    pub event_id: [u8; 32],
    /// Unix timestamp when claim occurred.
    pub claimed_at: i64,
    /// PDA bump seed.
    pub bump: u8,
}

impl ClaimRecord {
    // 8 (discriminator) + 32 + 32 + 8 + 1 = 81 bytes
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1;
}