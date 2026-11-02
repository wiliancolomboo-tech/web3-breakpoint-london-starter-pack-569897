use anchor_lang::prelude::*;

declare_id!("BrkPntLndn1111111111111111111111111111111111");

#[program]
pub mod breakpoint_starter_pack {
    use super::*;

    pub fn initialize_event(
        ctx: Context<InitializeEvent>,
        event_id: String,
        name: String,
        max_capacity: u32,
    ) -> Result<()> {
        require!(event_id.len() > 0 && event_id.len() <= 32, BreakpointError::InvalidEventIdLength);
        require!(name.len() > 0 && name.len() <= 64, BreakpointError::InvalidNameLength);
        require!(max_capacity > 0, BreakpointError::InvalidCapacity);

        let event = &mut ctx.accounts.event;
        event.authority = ctx.accounts.authority.key();
        event.event_id = event_id;
        event.name = name;
        event.max_capacity = max_capacity;
        event.total_registered = 0;
        event.total_checked_in = 0;
        event.is_active = true;
        event.bump = ctx.bumps.event;

        emit!(EventInitialized {
            event_id: event.event_id.clone(),
            authority: event.authority,
            max_capacity,
        });

        Ok(())
    }

    pub fn register_pass(
        ctx: Context<RegisterPass>,
        tier: PassTier,
        metadata_uri: String,
    ) -> Result<()> {
        require!(metadata_uri.len() <= 128, BreakpointError::InvalidMetadataUri);
        
        let event = &mut ctx.accounts.event;
        require!(event.is_active, BreakpointError::EventInactive);
        require!(event.total_registered < event.max_capacity, BreakpointError::CapacityExceeded);

        let pass = &mut ctx.accounts.pass;
        pass.event = event.key();
        pass.attendee = ctx.accounts.attendee.key();
        pass.tier = tier;
        pass.metadata_uri = metadata_uri;
        pass.is_checked_in = false;
        pass.check_in_timestamp = 0;
        pass.perks_claimed_mask = 0;
        pass.bump = ctx.bumps.pass;

        event.total_registered = event.total_registered.checked_add(1)
            .ok_or(BreakpointError::ArithmeticOverflow)?;

        emit!(PassRegistered {
            event: event.key(),
            attendee: pass.attendee,
            tier: pass.tier,
            pass_pda: pass.key(),
        });

        Ok(())
    }

    pub fn check_in(ctx: Context<CheckIn>) -> Result<()> {
        let event = &mut ctx.accounts.event;
        let pass = &mut ctx.accounts.pass;

        require!(event.is_active, BreakpointError::EventInactive);
        require!(!pass.is_checked_in, BreakpointError::AlreadyCheckedIn);

        let clock = Clock::get()?;
        pass.is_checked_in = true;
        pass.check_in_timestamp = clock.unix_timestamp;

        event.total_checked_in = event.total_checked_in.checked_add(1)
            .ok_or(BreakpointError::ArithmeticOverflow)?;

        emit!(AttendeeCheckedIn {
            event: event.key(),
            attendee: pass.attendee,
            timestamp: pass.check_in_timestamp,
        });

        Ok(())
    }

    pub fn claim_perk(
        ctx: Context<ClaimPerk>,
        perk_id: u8,
    ) -> Result<()> {
        require!(perk_id < 64, BreakpointError::InvalidPerkId);

        let pass = &mut ctx.accounts.pass;
        require!(pass.is_checked_in, BreakpointError::MustBeCheckedInToClaimPerk);

        let mask = 1u64 << perk_id;
        require!((pass.perks_claimed_mask & mask) == 0, BreakpointError::PerkAlreadyClaimed);

        // Mark perk as claimed via bitwise OR
        pass.perks_claimed_mask |= mask;

        emit!(PerkClaimed {
            event: ctx.accounts.event.key(),
            attendee: pass.attendee,
            perk_id,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// DATA STRUCTURES & ACCOUNTS
// -----------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PassTier {
    General,
    Hacker,
    VIP,
    Speaker,
}

#[account]
pub struct EventAccount {
    pub authority: Pubkey,       // 32
    pub event_id: String,        // 4 + 32
    pub name: String,            // 4 + 64
    pub max_capacity: u32,       // 4
    pub total_registered: u32,   // 4
    pub total_checked_in: u32,   // 4
    pub is_active: bool,         // 1
    pub bump: u8,                // 1
}

impl EventAccount {
    pub const LEN: usize = 8 + 32 + (4 + 32) + (4 + 64) + 4 + 4 + 4 + 1 + 1;
}

#[account]
pub struct PassAccount {
    pub event: Pubkey,           // 32
    pub attendee: Pubkey,        // 32
    pub tier: PassTier,          // 1
    pub metadata_uri: String,    // 4 + 128
    pub is_checked_in: bool,     // 1
    pub check_in_timestamp: i64, // 8
    pub perks_claimed_mask: u64, // 8 (Bitmask supporting up to 64 individual sponsor perks)
    pub bump: u8,                // 1
}

impl PassAccount {
    pub const LEN: usize = 8 + 32 + 32 + 1 + (4 + 128) + 1 + 8 + 8 + 1;
}

// -----------------------------------------------------------------------------
// CONTEXT INSTRUCTIONS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct InitializeEvent<'info> {
    #[account(
        init,
        payer = authority,
        space = EventAccount::LEN,
        seeds = [b"event", event_id.as_bytes()],
        bump
    )]
    pub event: Account<'info, EventAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterPass<'info> {
    #[account(
        mut,
        seeds = [b"event", event.event_id.as_bytes()],
        bump = event.bump
    )]
    pub event: Account<'info, EventAccount>,

    #[account(
        init,
        payer = payer,
        space = PassAccount::LEN,
        seeds = [b"pass", event.key().as_ref(), attendee.key().as_ref()],
        bump
    )]
    pub pass: Account<'info, PassAccount>,

    /// CHECK: The public key of the attendee who owns this pass.
    pub attendee: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckIn<'info> {
    #[account(
        mut,
        has_one = authority @ BreakpointError::UnauthorizedAuthority,
        seeds = [b"event", event.event_id.as_bytes()],
        bump = event.bump
    )]
    pub event: Account<'info, EventAccount>,

    #[account(
        mut,
        seeds = [b"pass", event.key().as_ref(), pass.attendee.as_ref()],
        bump = pass.bump
    )]
    pub pass: Account<'info, PassAccount>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimPerk<'info> {
    #[account(
        seeds = [b"event", event.event_id.as_bytes()],
        bump = event.bump
    )]
    pub event: Account<'info, EventAccount>,

    #[account(
        mut,
        seeds = [b"pass", event.key().as_ref(), attendee.key().as_ref()],
        bump = pass.bump
    )]
    pub pass: Account<'info, PassAccount>,

    pub attendee: Signer<'info>,
}

// -----------------------------------------------------------------------------
// EVENTS & ERRORS
// -----------------------------------------------------------------------------

#[event]
pub struct EventInitialized {
    pub event_id: String,
    pub authority: Pubkey,
    pub max_capacity: u32,
}

#[event]
pub struct PassRegistered {
    pub event: Pubkey,
    pub attendee: Pubkey,
    pub tier: PassTier,
    pub pass_pda: Pubkey,
}

#[event]
pub struct AttendeeCheckedIn {
    pub event: Pubkey,
    pub attendee: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PerkClaimed {
    pub event: Pubkey,
    pub attendee: Pubkey,
    pub perk_id: u8,
    pub timestamp: i64,
}

#[error_code]
pub enum BreakpointError {
    #[msg("Event ID must be between 1 and 32 characters.")]
    InvalidEventIdLength,
    #[msg("Event name must be between 1 and 64 characters.")]
    InvalidNameLength,
    #[msg("Capacity must be greater than zero.")]
    InvalidCapacity,
    #[msg("Metadata URI exceeds maximum allowed length of 128 bytes.")]
    InvalidMetadataUri,
    #[msg("The event is currently inactive.")]
    EventInactive,
    #[msg("Event max capacity reached.")]
    CapacityExceeded,
    #[msg("Attendee is already checked in.")]
    AlreadyCheckedIn,
    #[msg("Must check in to the event prior to claiming sponsor perks.")]
    MustBeCheckedInToClaimPerk,
    #[msg("Perk ID must be within 0 to 63.")]
    InvalidPerkId,
    #[msg("This perk has already been claimed.")]
    PerkAlreadyClaimed,
    #[msg("Signer is not authorized to perform this operation.")]
    UnauthorizedAuthority,
    #[msg("Arithmetic overflow occurred.")]
    ArithmeticOverflow,
}