use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::errors::StarterPackError;
use crate::state::{ClaimRecord, EventRegistry};

#[derive(Accounts)]
#[instruction(event_id: [u8; 32])]
pub struct ClaimPerk<'info> {
    #[account(
        mut,
        seeds = [b"event", event_id.as_ref()],
        bump = event_registry.bump,
        has_one = authority @ StarterPackError::UnauthorizedAdmin
    )]
    pub event_registry: Account<'info, EventRegistry>,

    /// CHECK: PDA holding the native lamport perks
    #[account(
        mut,
        seeds = [b"vault", event_id.as_ref()],
        bump = event_registry.vault_bump
    )]
    pub treasury_vault: SystemAccount<'info>,

    #[account(
        init,
        payer = fee_payer,
        space = ClaimRecord::LEN,
        seeds = [b"claim", event_id.as_ref(), attendee.key().as_ref()],
        bump
    )]
    pub claim_record: Account<'info, ClaimRecord>,

    /// The attendee receiving the starter pack perk
    /// CHECK: Validated as recipient of lamport perk
    #[account(mut)]
    pub attendee: SystemAccount<'info>,

    /// Enterprise gas sponsor / relayer
    #[account(mut)]
    pub fee_payer: Signer<'info>,

    /// Authority account required for has_one check
    pub authority: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_claim_perk(ctx: Context<ClaimPerk>, event_id: [u8; 32]) -> Result<()> {
    let event = &mut ctx.accounts.event_registry;

    require!(event.is_active, StarterPackError::EventInactive);
    require!(event.total_claims < event.max_claims, StarterPackError::InsufficientVaultBalance);

    let vault_balance = ctx.accounts.treasury_vault.lamports();
    require!(
        vault_balance >= event.perk_amount,
        StarterPackError::InsufficientVaultBalance
    );

    // Populate Claim Record
    let record = &mut ctx.accounts.claim_record;
    record.attendee = ctx.accounts.attendee.key();
    record.event_id = event_id;
    record.claimed_at = Clock::get()?.unix_timestamp;
    record.bump = ctx.bumps.claim_record;

    // Increment claims
    event.total_claims = event
        .total_claims
        .checked_add(1)
        .ok_or(StarterPackError::NumericalOverflow)?;

    // Transfer Perk Lamports from Vault PDA to Attendee via CPI with seeds
    let seeds = &[
        b"vault".as_ref(),
        event_id.as_ref(),
        &[event.vault_bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.treasury_vault.to_account_info(),
            to: ctx.accounts.attendee.to_account_info(),
        },
        signer_seeds,
    );
    system_program::transfer(cpi_ctx, event.perk_amount)?;

    msg!(
        "Claim successful: Attendee {} claimed {} lamports from event {:?}",
        ctx.accounts.attendee.key(),
        event.perk_amount,
        event_id
    );

    Ok(())
}