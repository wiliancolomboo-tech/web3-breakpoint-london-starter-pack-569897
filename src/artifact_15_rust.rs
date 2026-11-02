use anchor_lang::prelude::*;
use solana_program::keccak;
use crate::state::{EventConfig, AttendeePassport};
use crate::errors::BreakpointError;

#[derive(Accounts)]
pub struct ClaimMerklePerk<'info> {
    #[account(
        seeds = [EventConfig::SEED_PREFIX, config.event_id.to_le_bytes().as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, EventConfig>,

    #[account(
        mut,
        seeds = [EventConfig::VAULT_PREFIX, config.event_id.to_le_bytes().as_ref()],
        bump = config.vault_bump
    )]
    pub vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [
            AttendeePassport::SEED_PREFIX,
            config.event_id.to_le_bytes().as_ref(),
            attendee.key().as_ref()
        ],
        bump = passport.bump,
        has_one = attendee
    )]
    pub passport: Account<'info, AttendeePassport>,

    #[account(mut)]
    pub attendee: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ClaimMerklePerk>,
    perk_index: u32,
    lamport_reward: u64,
    merkle_proof: Vec<[u8; 32]>,
) -> Result<()> {
    let passport = &mut ctx.accounts.passport;
    let config = &ctx.accounts.config;

    require!(passport.is_active, BreakpointError::PassportSuspended);
    require!(perk_index < 128, BreakpointError::InvalidMerkleProof);

    // 1. Double-claim bitmap check
    let bit_mask = 1u128 << perk_index;
    require!(
        (passport.claim_bitmap & bit_mask) == 0,
        BreakpointError::PerkAlreadyClaimed
    );

    // 2. Cryptographic Merkle Root Verification
    let leaf = keccak::hashv(&[
        passport.attendee.as_ref(),
        &perk_index.to_le_bytes(),
        &lamport_reward.to_le_bytes(),
    ]);

    let mut current_hash = leaf.0;
    for proof_element in merkle_proof.iter() {
        if current_hash <= *proof_element {
            current_hash = keccak::hashv(&[&current_hash, proof_element]).0;
        } else {
            current_hash = keccak::hashv(&[proof_element, &current_hash]).0;
        }
    }

    require!(
        current_hash == config.merkle_root,
        BreakpointError::InvalidMerkleProof
    );

    // 3. Update state bitmask
    passport.claim_bitmap |= bit_mask;

    // 4. Safe Vault Transfer via PDA lamport realloc / transfer
    if lamport_reward > 0 {
        let vault_info = ctx.accounts.vault.to_account_info();
        let attendee_info = ctx.accounts.attendee.to_account_info();

        **vault_info.try_borrow_mut_lamports()? = vault_info
            .lamports()
            .checked_sub(lamport_reward)
            .ok_or(BreakpointError::NumericalOverflow)?;

        **attendee_info.try_borrow_mut_lamports()? = attendee_info
            .lamports()
            .checked_add(lamport_reward)
            .ok_or(BreakpointError::NumericalOverflow)?;
    }

    Ok(())
}