use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("LonPack1111111111111111111111111111111111111");

#[program]
pub mod london_starter_pack {
    use super::*;

    pub fn initialize_event(
        ctx: Context<InitializeEvent>,
        event_id: [u8; 32],
        name: String,
        perk_amount: u64,
        max_claims: u64,
    ) -> Result<()> {
        instructions::initialize_event::handle_initialize_event(
            ctx,
            event_id,
            name,
            perk_amount,
            max_claims,
        )
    }

    pub fn claim_perk(ctx: Context<ClaimPerk>, event_id: [u8; 32]) -> Result<()> {
        instructions::claim_perk::handle_claim_perk(ctx, event_id)
    }

    pub fn emergency_freeze(
        ctx: Context<EmergencyFreeze>,
        event_id: [u8; 32],
        freeze: bool,
    ) -> Result<()> {
        instructions::emergency_freeze::handle_emergency_freeze(ctx, event_id, freeze)
    }
}