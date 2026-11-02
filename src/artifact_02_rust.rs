use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("BrkPntLndn1111111111111111111111111111111111");

#[program]
pub mod breakpoint_starter_pack {
    use super::*;

    /// Initializes a new Breakpoint Event instance with global configurations.
    pub fn initialize_event(
        ctx: Context<InitializeEvent>,
        event_id: String,
        event_name: String,
        max_capacity: u32,
    ) -> Result<()> {
        require!(event_id.len() <= 32, BreakpointError::StringTooLong);
        require!(event_name.len() <= 64, BreakpointError::StringTooLong);
        require!(max_capacity > 0, BreakpointError::InvalidCapacity);

        let event_state = &mut ctx.accounts.event_state;
        event_state.authority = ctx.accounts.authority.key();
        event_state.event_id = event_id.clone();
        event_state.event_name = event_name;
        event_state.max_capacity = max_capacity;
        event_state.issued_passes = 0;
        event_state.is_active = true;
        event_state.bump = ctx.bumps.event_state;

        emit!(EventInitialized {
            event_id,
            authority: ctx.accounts.authority.key(),
            max_capacity,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Deposits native SOL into the Sponsor Micro-Grant / Swag Escrow Vault.
    pub fn fund_sponsor_escrow(
        ctx: Context<FundSponsorEscrow>,
        event_id: String,
        sponsor_name: String,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, BreakpointError::InvalidAmount);
        require!(sponsor_name.len() <= 32, BreakpointError::StringTooLong);

        // Native SOL transfer from sponsor wallet to escrow PDA vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.sponsor.to_account_info(),
                to: ctx.accounts.escrow_vault.to_account_info(),
            },
        );
        transfer(cpi_context, amount)?;

        let escrow_account = &mut ctx.accounts.escrow_vault;
        escrow_account.sponsor = ctx.accounts.sponsor.key();
        escrow_account.event_id = event_id.clone();
        escrow_account.sponsor_name = sponsor_name.clone();
        escrow_account.total_funded = escrow_account.total_funded.saturating_add(amount);
        escrow_account.remaining_balance = escrow_account.remaining_balance.saturating_add(amount);
        escrow_account.bump = ctx.bumps.escrow_vault;

        emit!(EscrowFunded {
            event_id,
            sponsor: ctx.accounts.sponsor.key(),
            sponsor_name,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Issues a verifiable Breakpoint London Attendee Pass PDA.
    pub fn issue_pass(
        ctx: Context<IssuePass>,
        event_id: String,
        attendee_tier: AttendeeTier,
    ) -> Result<()> {
        let event_state = &mut ctx.accounts.event_state;
        require!(event_state.is_active, BreakpointError::EventInactive);
        require!(
            event_state.issued_passes < event_state.max_capacity,
            BreakpointError::CapacityExceeded
        );

        let pass = &mut ctx.accounts.attendee_pass;
        pass.recipient = ctx.accounts.recipient.key();
        pass.event_id = event_id.clone();
        pass.tier = attendee_tier;
        pass.is_checked_in = false;
        pass.swag_claimed = false;
        pass.grants_claimed = 0;
        pass.issued_at = Clock::get()?.unix_timestamp;
        pass.bump = ctx.bumps.attendee_pass;

        event_state.issued_passes = event_state.issued_passes.saturating_add(1);

        emit!(PassIssued {
            event_id,
            recipient: ctx.accounts.recipient.key(),
            tier: attendee_tier,
            timestamp: pass.issued_at,
        });

        Ok(())
    }

    /// Turnstile Check-In executed by an authorized gate delegate.
    pub fn check_in_attendee(ctx: Context<CheckInAttendee>, event_id: String) -> Result<()> {
        let pass = &mut ctx.accounts.attendee_pass;
        require!(!pass.is_checked_in, BreakpointError::AlreadyCheckedIn);

        pass.is_checked_in = true;
        let now = Clock::get()?.unix_timestamp;

        emit!(AttendeeCheckedIn {
            event_id,
            recipient: pass.recipient,
            timestamp: now,
        });

        Ok(())
    }

    /// Hacker or attendee claims a micro-grant or swag stipend from the sponsor escrow.
    pub fn claim_sponsor_grant(
        ctx: Context<ClaimSponsorGrant>,
        event_id: String,
        claim_amount: u64,
    ) -> Result<()> {
        let pass = &mut ctx.accounts.attendee_pass;
        let escrow = &mut ctx.accounts.escrow_vault;

        require!(pass.is_checked_in, BreakpointError::AttendeeNotCheckedIn);
        require!(!pass.swag_claimed, BreakpointError::SwagAlreadyClaimed);
        require!(
            escrow.remaining_balance >= claim_amount,
            BreakpointError::InsufficientEscrowBalance
        );
        require!(claim_amount > 0, BreakpointError::InvalidAmount);

        // Prevent drained account rent-exemption failure
        let escrow_info = ctx.accounts.escrow_vault.to_account_info();
        let rent_minimum = Rent::get()?.minimum_balance(EscrowVault::LEN);
        let available_lamports = escrow_info.lamports().saturating_sub(rent_minimum);
        require!(
            claim_amount <= available_lamports,
            BreakpointError::EscrowDrainExceedsRent
        );

        // Program PDA signer transfers SOL directly to recipient
        **escrow_info.try_borrow_mut_lamports()? = escrow_info
            .lamports()
            .checked_sub(claim_amount)
            .ok_or(BreakpointError::NumericalOverflow)?;

        let recipient_info = ctx.accounts.recipient.to_account_info();
        **recipient_info.try_borrow_mut_lamports()? = recipient_info
            .lamports()
            .checked_add(claim_amount)
            .ok_or(BreakpointError::NumericalOverflow)?;

        escrow.remaining_balance = escrow.remaining_balance.saturating_sub(claim_amount);
        pass.swag_claimed = true;
        pass.grants_claimed = pass.grants_claimed.saturating_add(claim_amount);

        emit!(GrantDisbursed {
            event_id,
            sponsor: escrow.sponsor,
            recipient: pass.recipient,
            amount: claim_amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Closes event upon conclusion, preventing further mints.
    pub fn set_event_status(
        ctx: Context<SetEventStatus>,
        _event_id: String,
        is_active: bool,
    ) -> Result<()> {
        let event_state = &mut ctx.accounts.event_state;
        event_state.is_active = is_active;
        Ok(())
    }
}

// ----------------------------------------------------------------------------
// ACCOUNT STRUCTURES & CONTEXTS
// ----------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AttendeeTier {
    General,
    Hacker,
    VipSpeaker,
    SponsorDelegate,
}

#[account]
pub struct EventState {
    pub authority: Pubkey,       // 32
    pub event_id: String,        // 4 + 32
    pub event_name: String,      // 4 + 64
    pub max_capacity: u32,       // 4
    pub issued_passes: u32,      // 4
    pub is_active: bool,         // 1
    pub bump: u8,                // 1
}

impl EventState {
    pub const LEN: usize = 8 + 32 + (4 + 32) + (4 + 64) + 4 + 4 + 1 + 1;
}

#[account]
pub struct AttendeePass {
    pub recipient: Pubkey,       // 32
    pub event_id: String,        // 4 + 32
    pub tier: AttendeeTier,      // 1
    pub is_checked_in: bool,     // 1
    pub swag_claimed: bool,      // 1
    pub grants_claimed: u64,     // 8
    pub issued_at: i64,          // 8
    pub bump: u8,                // 1
}

impl AttendeePass {
    pub const LEN: usize = 8 + 32 + (4 + 32) + 1 + 1 + 1 + 8 + 8 + 1;
}

#[account]
pub struct EscrowVault {
    pub sponsor: Pubkey,         // 32
    pub event_id: String,        // 4 + 32
    pub sponsor_name: String,    // 4 + 32
    pub total_funded: u64,       // 8
    pub remaining_balance: u64,  // 8
    pub bump: u8,                // 1
}

impl EscrowVault {
    pub const LEN: usize = 8 + 32 + (4 + 32) + (4 + 32) + 8 + 8 + 1;
}

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct InitializeEvent<'info> {
    #[account(
        init,
        payer = authority,
        space = EventState::LEN,
        seeds = [b"event", event_id.as_bytes()],
        bump
    )]
    pub event_state: Account<'info, EventState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct FundSponsorEscrow<'info> {
    #[account(
        init_if_needed,
        payer = sponsor,
        space = EscrowVault::LEN,
        seeds = [b"escrow", event_id.as_bytes(), sponsor.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, EscrowVault>,
    #[account(mut)]
    pub sponsor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct IssuePass<'info> {
    #[account(
        mut,
        seeds = [b"event", event_id.as_bytes()],
        bump = event_state.bump,
        has_one = authority @ BreakpointError::Unauthorized
    )]
    pub event_state: Account<'info, EventState>,
    #[account(
        init,
        payer = authority,
        space = AttendeePass::LEN,
        seeds = [b"pass", event_id.as_bytes(), recipient.key().as_ref()],
        bump
    )]
    pub attendee_pass: Account<'info, AttendeePass>,
    /// CHECK: Target attendee wallet receiving the credential
    pub recipient: AccountInfo<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct CheckInAttendee<'info> {
    #[account(
        seeds = [b"event", event_id.as_bytes()],
        bump = event_state.bump,
        has_one = authority @ BreakpointError::Unauthorized
    )]
    pub event_state: Account<'info, EventState>,
    #[account(
        mut,
        seeds = [b"pass", event_id.as_bytes(), attendee_pass.recipient.as_ref()],
        bump = attendee_pass.bump
    )]
    pub attendee_pass: Account<'info, AttendeePass>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct ClaimSponsorGrant<'info> {
    #[account(
        mut,
        seeds = [b"pass", event_id.as_bytes(), recipient.key().as_ref()],
        bump = attendee_pass.bump,
        has_one = recipient @ BreakpointError::Unauthorized
    )]
    pub attendee_pass: Account<'info, AttendeePass>,
    #[account(
        mut,
        seeds = [b"escrow", event_id.as_bytes(), escrow_vault.sponsor.as_ref()],
        bump = escrow_vault.bump
    )]
    pub escrow_vault: Account<'info, EscrowVault>,
    #[account(mut)]
    pub recipient: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct SetEventStatus<'info> {
    #[account(
        mut,
        seeds = [b"event", event_id.as_bytes()],
        bump = event_state.bump,
        has_one = authority @ BreakpointError::Unauthorized
    )]
    pub event_state: Account<'info, EventState>,
    pub authority: Signer<'info>,
}

// ----------------------------------------------------------------------------
// EVENTS & ERROR DEFINITIONS
// ----------------------------------------------------------------------------

#[event]
pub struct EventInitialized {
    pub event_id: String,
    pub authority: Pubkey,
    pub max_capacity: u32,
    pub timestamp: i64,
}

#[event]
pub struct EscrowFunded {
    pub event_id: String,
    pub sponsor: Pubkey,
    pub sponsor_name: String,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct PassIssued {
    pub event_id: String,
    pub recipient: Pubkey,
    pub tier: AttendeeTier,
    pub timestamp: i64,
}

#[event]
pub struct AttendeeCheckedIn {
    pub event_id: String,
    pub recipient: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct GrantDisbursed {
    pub event_id: String,
    pub sponsor: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum BreakpointError {
    #[msg("String exceeds maximum length allocation")]
    StringTooLong,
    #[msg("Invalid event capacity provided")]
    InvalidCapacity,
    #[msg("Event registration is inactive")]
    EventInactive,
    #[msg("Event maximum capacity has been reached")]
    CapacityExceeded,
    #[msg("Signer is unauthorized to perform this operational action")]
    Unauthorized,
    #[msg("Attendee is already checked in")]
    AlreadyCheckedIn,
    #[msg("Attendee must check in before claiming grant")]
    AttendeeNotCheckedIn,
    #[msg("Swag or stipend has already been claimed")]
    SwagAlreadyClaimed,
    #[msg("Insufficient balance in sponsor escrow vault")]
    InsufficientEscrowBalance,
    #[msg("Cannot withdraw below rent-exemption minimum")]
    EscrowDrainExceedsRent,
    #[msg("Numerical overflow during balance computation")]
    NumericalOverflow,
    #[msg("Invalid amount specified")]
    InvalidAmount,
}