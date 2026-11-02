use anchor_lang::prelude::*;
use crate::errors::StarterPackError;
use crate::state::EventRegistry;

#[derive(Accounts)]
#[instruction(event_id: [u8; 32], name: String)]
pub struct InitializeEvent<'info> {
    #[account(
        init,
        payer = authority,
        space = EventRegistry::LEN,
        seeds = [b"event", event_id.as_ref()],
        bump
    )]
    pub event_registry: Account<'info, EventRegistry>,

    /// CHECK: PDA Treasury vault holding perk lamports.
    #[account(
        mut,
        seeds = [b"vault", event_id.as_ref()],
        bump
    )]
    pub treasury_vault: SystemAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_event(
    ctx: Context<InitializeEvent>,
    event_id: [u8; 32],
    name: String,
    perk_amount: u64,
    max_claims: u64,
) -> Result<()> {
    require!(name.len() <= 64, StarterPackError::EventNameTooLong);

    let event = &mut ctx.accounts.event_registry;
    event.authority = ctx.accounts.authority.key();
    event.event_id = event_id;
    event.name = name;
    event.perk_amount = perk_amount;
    event.total_claims = 0;
    event.max_claims = max_claims;
    event.is_active = true;
    event.bump = ctx.bumps.event_registry;
    event.vault_bump = ctx.bumps.treasury_vault;

    msg!("Initialized Breakpoint London Event: {:?}", event_id);
    Ok(())
}