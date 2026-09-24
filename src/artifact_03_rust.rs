use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, MintTo, TransferChecked};
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};

declare_id!("BrkPntLndn111111111111111111111111111111111");

pub const MAX_WINNERS_PER_TRACK: usize = 5;
pub const CONFIG_SEED: &[u8] = b"global-config";
pub const VAULT_SEED: &[u8] = b"bounty-vault";
pub const BADGE_SEED: &[u8] = b"attendee-badge";

#[program]
pub mod breakpoint_london_pack {
    use super::*;

    /// Initialize the global Breakpoint configuration and admin authority
    pub fn initialize(
        ctx: Context<Initialize>,
        fee_basis_points: u16,
        disbursement_delay_slots: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.treasury = ctx.accounts.treasury.key();
        config.protocol_fee_bps = fee_basis_points;
        config.disbursement_delay_slots = disbursement_delay_slots;
        config.is_paused = false;
        config.total_events = 0;
        config.bump = ctx.bumps.config;

        msg!("Breakpoint London Master Config initialized by: {:?}", config.admin);
        Ok(())
    }

    /// Register a hacker, validating attendance and minting a Soulbound Token-2022 credential
    pub fn register_hacker(
        ctx: Context<RegisterHacker>,
        event_id: u64,
        hacker_handle_hash: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused, BreakpointError::ProtocolPaused);

        let badge = &mut ctx.accounts.hacker_badge;
        let clock = Clock::get()?;

        badge.hacker = ctx.accounts.hacker.key();
        badge.event_id = event_id;
        badge.handle_hash = hacker_handle_hash;
        badge.checkin_timestamp = clock.unix_timestamp;
        badge.track_assigned = 0; // Default track; updated upon submission
        badge.bump = ctx.bumps.hacker_badge;

        // Mint attendee credential badge via Token-2022 CPI using Program Derived Address (PDA)
        let seeds: &[&[&[u8]]] = &[&[
            CONFIG_SEED,
            &[ctx.accounts.config.bump],
        ]];

        let mint_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.badge_mint.to_account_info(),
                to: ctx.accounts.badge_token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            seeds,
        );

        token_2022::mint_to(mint_ctx, 1)?;

        msg!("Hacker registered: {:?} for event: {}", badge.hacker, event_id);
        Ok(())
    }

    /// Sponsor deposits prize funds into a Track Bounty Escrow Vault
    pub fn fund_track_vault(
        ctx: Context<FundTrackVault>,
        track_id: u8,
        amount: u64,
        unlock_slot: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused, BreakpointError::ProtocolPaused);
        require!(amount > 0, BreakpointError::ZeroDeposit);
        let clock = Clock::get()?;
        require!(unlock_slot > clock.slot, BreakpointError::InvalidTimelock);

        let vault = &mut ctx.accounts.track_vault;
        if vault.total_allocation == 0 {
            vault.track_id = track_id;
            vault.sponsor = ctx.accounts.sponsor.key();
            vault.unlock_slot = unlock_slot;
            vault.bump = ctx.bumps.track_vault;
            vault.token_mint = ctx.accounts.vault_mint.key();
        }

        vault.total_allocation = vault
            .total_allocation
            .checked_add(amount)
            .ok_or(BreakpointError::MathOverflow)?;
        vault.remaining_balance = vault
            .remaining_balance
            .checked_add(amount)
            .ok_or(BreakpointError::MathOverflow)?;

        let decimals = ctx.accounts.vault_mint.decimals;

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.sponsor_token_account.to_account_info(),
            mint: ctx.accounts.vault_mint.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.sponsor.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );

        token_2022::transfer_checked(cpi_ctx, amount, decimals)?;

        msg!("Vault funded for Track {}. Added: {} units", track_id, amount);
        Ok(())
    }

    /// Disburse bounty payouts to vetted winners according to predefined basis points
    pub fn disburse_prizes(
        ctx: Context<DisbursePrizes>,
        track_id: u8,
        basis_points_split: Vec<u16>,
    ) -> Result<()> {
        require!(!ctx.accounts.config.is_paused, BreakpointError::ProtocolPaused);
        let clock = Clock::get()?;
        let vault = &mut ctx.accounts.track_vault;

        require!(clock.slot >= vault.unlock_slot, BreakpointError::TimelockActive);
        require!(basis_points_split.len() <= MAX_WINNERS_PER_TRACK, BreakpointError::TooManyRecipients);
        require!(ctx.remaining_accounts.len() == basis_points_split.len(), BreakpointError::AccountMismatch);

        let total_bps: u16 = basis_points_split.iter().sum();
        require!(total_bps == 10_000, BreakpointError::InvalidBpsTotal);

        let total_pool = vault.remaining_balance;
        let decimals = ctx.accounts.vault_mint.decimals;
        let bump = vault.bump;

        let signer_seeds: &[&[&[u8]]] = &[&[
            VAULT_SEED,
            &[track_id],
            &[bump],
        ]];

        for (i, bps) in basis_points_split.iter().enumerate() {
            let payout = (total_pool as u128)
                .checked_mul(*bps as u128)
                .ok_or(BreakpointError::MathOverflow)?
                .checked_div(10_000)
                .ok_or(BreakpointError::MathOverflow)? as u64;

            if payout == 0 {
                continue;
            }

            let winner_account_info = &ctx.remaining_accounts[i];

            let cpi_accounts = TransferChecked {
                from: ctx.accounts.vault_token_account.to_account_info(),
                mint: ctx.accounts.vault_mint.to_account_info(),
                to: winner_account_info.clone(),
                authority: vault.to_account_info(),
            };

            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );

            token_2022::transfer_checked(cpi_ctx, payout, decimals)?;
        }

        vault.remaining_balance = 0;
        msg!("Bounty payout execution complete for Track {}", track_id);
        Ok(())
    }

    /// Circuit breaker emergency toggle for incident response
    pub fn set_circuit_breaker(ctx: Context<SetCircuitBreaker>, pause: bool) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.is_paused = pause;
        msg!("Protocol Circuit Breaker set to: {}", pause);
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT CONTEXTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Treasury receiving address validated in Anchor struct
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(event_id: u64)]
pub struct RegisterHacker<'info> {
    #[account(
        init,
        payer = hacker,
        space = 8 + AttendeeBadge::INIT_SPACE,
        seeds = [BADGE_SEED, event_id.to_le_bytes().as_ref(), hacker.key().as_ref()],
        bump
    )]
    pub hacker_badge: Account<'info, AttendeeBadge>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        mint::authority = config,
        mint::token_program = token_program
    )]
    pub badge_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = badge_mint,
        token::authority = hacker,
        token::token_program = token_program
    )]
    pub badge_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub hacker: Signer<'info>,

    pub token_program: Interface<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(track_id: u8)]
pub struct FundTrackVault<'info> {
    #[account(
        init_if_needed,
        payer = sponsor,
        space = 8 + TrackVault::INIT_SPACE,
        seeds = [VAULT_SEED, &[track_id]],
        bump
    )]
    pub track_vault: Account<'info, TrackVault>,

    pub vault_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = vault_mint,
        associated_token::authority = sponsor,
        associated_token::token_program = token_program
    )]
    pub sponsor_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = sponsor,
        associated_token::mint = vault_mint,
        associated_token::authority = track_vault,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub sponsor: Signer<'info>,

    pub token_program: Interface<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(track_id: u8)]
pub struct DisbursePrizes<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ BreakpointError::UnauthorizedAdmin
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [VAULT_SEED, &[track_id]],
        bump = track_vault.bump,
        has_one = vault_mint @ BreakpointError::InvalidMint
    )]
    pub track_vault: Account<'info, TrackVault>,

    pub vault_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = vault_mint,
        associated_token::authority = track_vault,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    pub admin: Signer<'info>,
    pub token_program: Interface<'info, Token2022>,
}

#[derive(Accounts)]
pub struct SetCircuitBreaker<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ BreakpointError::UnauthorizedAdmin
    )]
    pub config: Account<'info, GlobalConfig>,
    pub admin: Signer<'info>,
}

// -----------------------------------------------------------------------------
// STATE SCHEMAS
// -----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub admin: Pubkey,                   // 32
    pub treasury: Pubkey,                // 32
    pub protocol_fee_bps: u16,           // 2
    pub disbursement_delay_slots: u64,   // 8
    pub is_paused: bool,                 // 1
    pub total_events: u64,               // 8
    pub bump: u8,                        // 1
}

#[account]
#[derive(InitSpace)]
pub struct TrackVault {
    pub track_id: u8,                    // 1
    pub sponsor: Pubkey,                 // 32
    pub token_mint: Pubkey,              // 32
    pub total_allocation: u64,           // 8
    pub remaining_balance: u64,          // 8
    pub unlock_slot: u64,                // 8
    pub bump: u8,                        // 1
}

#[account]
#[derive(InitSpace)]
pub struct AttendeeBadge {
    pub hacker: Pubkey,                  // 32
    pub event_id: u64,                   // 8
    pub handle_hash: [u8; 32],           // 32
    pub checkin_timestamp: i64,          // 8
    pub track_assigned: u8,              // 1
    pub bump: u8,                        // 1
}

// -----------------------------------------------------------------------------
// ERROR DEFINITIONS
// -----------------------------------------------------------------------------

#[error_code]
pub enum BreakpointError {
    #[msg("Protocol operations are currently paused by the circuit breaker.")]
    ProtocolPaused,
    #[msg("Signer is not authorized to perform administrative operations.")]
    UnauthorizedAdmin,
    #[msg("Deposit amount must be strictly greater than zero.")]
    ZeroDeposit,
    #[msg("Vault unlock slot must be in the future relative to current slot.")]
    InvalidTimelock,
    #[msg("Timelock has not expired yet. Payouts locked.")]
    TimelockActive,
    #[msg("Specified basis points distribution must equal exactly 10,000 (100%).")]
    InvalidBpsTotal,
    #[msg("Number of remaining accounts does not match basis points vector length.")]
    AccountMismatch,
    #[msg("Number of winner accounts exceeds protocol maximum allowed per track.")]
    TooManyRecipients,
    #[msg("Supplied token mint does not match the track vault's configured mint.")]
    InvalidMint,
    #[msg("Arithmetic overflow occurred during balance calculation.")]
    MathOverflow,
}