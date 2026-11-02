use anchor_lang::prelude::*;
use crate::errors::StarterPackError;
use crate::state::EventRegistry;

#[derive(Accounts)]
#[instruction(event_id: [u8; 32])]
pub struct EmergencyFreeze<'info> {
    #[account(
        mut,
        seeds = [b"event", event_id.as_ref()],
        bump = event_registry.bump,
        has_one = authority @ StarterPackError::UnauthorizedAdmin
    )]
    pub event_registry: Account<'info, EventRegistry>,

    pub authority: Signer<'info>,
}

pub fn handle_emergency_freeze(
    ctx: Context<EmergencyFreeze>,
    _event_id: [u8; 32],
    freeze_state: bool,
) -> Result<()> {
    let event = &mut ctx.accounts.event_registry;
    event.is_active = !freeze_state;
    msg!("Event active state updated to: {}", event.is_active);
    Ok(())
}