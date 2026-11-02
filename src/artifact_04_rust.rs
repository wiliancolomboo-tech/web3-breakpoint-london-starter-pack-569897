use anchor_lang::prelude::*;

declare_id!("BrkptLon11111111111111111111111111111111111");

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_BOOTHS: u8 = 32;

#[program]
pub mod breakpoint_core {
    use super::*;

    /// Initializes a new Breakpoint event instance with an authorized sponsor authority.
    pub fn initialize_event(
        ctx: Context<InitializeEvent>,
        event_id: String,
        event_name: String,
        max_attendees: u32,
    ) -> Result<()> {
        require!(
            event_id.as_bytes().len() <= 16,
            BreakpointError::EventIdTooLong
        );
        require!(
            event_name.as_bytes().len() <= MAX_NAME_LEN,
            BreakpointError::NameTooLong
        );

        let event = &mut ctx.accounts.event_config;
        event.authority = ctx.accounts.authority.key();
        event.event_id = event_id;
        event.event_name = event_name;
        event.attendee_count = 0;
        event.max_attendees = max_attendees;
        event.bump = ctx.bumps.event_config;
        event.is_active = true;

        emit!(EventInitialized {
            event_id: event.event_id.clone(),
            authority: event.authority,
            max_attendees,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Registers an attendee, initializing their passport and provisioning a session delegate.
    pub fn register_attendee(
        ctx: Context<RegisterAttendee>,
        attendee_name: String,
        session_delegate: Pubkey,
        session_expiry: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        require!(
            session_expiry > clock.unix_timestamp,
            BreakpointError::InvalidSessionExpiry
        );
        require!(
            attendee_name.as_bytes().len() <= MAX_NAME_LEN,
            BreakpointError::NameTooLong
        );

        let event = &mut ctx.accounts.event_config;
        require!(event.is_active, BreakpointError::EventInactive);
        require!(
            event.attendee_count < event.max_attendees,
            BreakpointError::EventCapacityReached
        );

        let passport = &mut ctx.accounts.passport;
        passport.owner = ctx.accounts.owner.key();
        passport.event = event.key();
        passport.session_delegate = session_delegate;
        passport.session_expiry = session_expiry;
        passport.attendee_name = attendee_name.clone();
        passport.check_in_bits = 0;
        passport.xp_points = 0;
        passport.badge_claimed = false;
        passport.bump = ctx.bumps.passport;

        event.attendee_count = event
            .attendee_count
            .checked_add(1)
            .ok_or(BreakpointError::ArithmeticOverflow)?;

        emit!(AttendeeRegistered {
            event_id: event.event_id.clone(),
            owner: passport.owner,
            delegate: session_delegate,
            name: attendee_name,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Records booth/workshop check-ins. Can be signed by owner OR authorized session delegate.
    pub fn record_check_in(ctx: Context<RecordCheckIn>, booth_id: u8) -> Result<()> {
        require!(booth_id < MAX_BOOTHS, BreakpointError::InvalidBoothId);

        let clock = Clock::get()?;
        let passport = &mut ctx.accounts.passport;
        let signer = ctx.accounts.authority_or_delegate.key();

        if signer != passport.owner {
            require!(
                signer == passport.session_delegate,
                BreakpointError::UnauthorizedSigner
            );
            require!(
                clock.unix_timestamp <= passport.session_expiry,
                BreakpointError::SessionExpired
            );
        }

        let bitmask: u32 = 1 << booth_id;
        require!(
            (passport.check_in_bits & bitmask) == 0,
            BreakpointError::AlreadyCheckedIn
        );

        passport.check_in_bits |= bitmask;
        passport.xp_points = passport
            .xp_points
            .checked_add(100)
            .ok_or(BreakpointError::ArithmeticOverflow)?;

        emit!(CheckInRecorded {
            passport: passport.key(),
            booth_id,
            total_xp: passport.xp_points,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Claims an on-chain completion badge if attendee visited the required number of checkpoints.
    pub fn claim_completion_badge(ctx: Context<ClaimBadge>, required_booths: u8) -> Result<()> {
        let passport = &mut ctx.accounts.passport;
        require!(!passport.badge_claimed, BreakpointError::BadgeAlreadyClaimed);

        let visited_count = passport.check_in_bits.count_ones() as u8;
        require!(
            visited_count >= required_booths,
            BreakpointError::InsufficientCheckins
        );

        passport.badge_claimed = true;
        passport.xp_points = passport
            .xp_points
            .checked_add(500)
            .ok_or(BreakpointError::ArithmeticOverflow)?;

        emit!(BadgeAwarded {
            passport: passport.key(),
            owner: passport.owner,
            total_xp: passport.xp_points,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Admin emergency toggle for event state.
    pub fn toggle_event_active(ctx: Context<AdminControl>, active: bool) -> Result<()> {
        let event = &mut ctx.accounts.event_config;
        event.is_active = active;
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT VALIDATION STRUCTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct InitializeEvent<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + EventConfig::INIT_SPACE,
        seeds = [b"event_config", event_id.as_bytes()],
        bump
    )]
    pub event_config: Account<'info, EventConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterAttendee<'info> {
    #[account(
        mut,
        seeds = [b"event_config", event_config.event_id.as_bytes()],
        bump = event_config.bump
    )]
    pub event_config: Account<'info, EventConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + AttendeePassport::INIT_SPACE,
        seeds = [b"passport", event_config.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub passport: Account<'info, AttendeePassport>,

    /// The attendee identity key
    pub owner: SystemAccount<'info>,

    /// Transaction payer (can be Relayer / Paymaster)
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordCheckIn<'info> {
    #[account(
        mut,
        seeds = [b"passport", passport.event.as_ref(), passport.owner.as_ref()],
        bump = passport.bump
    )]
    pub passport: Account<'info, AttendeePassport>,

    pub authority_or_delegate: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimBadge<'info> {
    #[account(
        mut,
        seeds = [b"passport", passport.event.as_ref(), passport.owner.as_ref()],
        bump = passport.bump,
        has_one = owner @ BreakpointError::UnauthorizedSigner
    )]
    pub passport: Account<'info, AttendeePassport>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminControl<'info> {
    #[account(
        mut,
        has_one = authority @ BreakpointError::UnauthorizedSigner
    )]
    pub event_config: Account<'info, EventConfig>,

    pub authority: Signer<'info>,
}

// -----------------------------------------------------------------------------
// STATE ACCOUNTS
// -----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct EventConfig {
    pub authority: Pubkey,
    #[max_len(16)]
    pub event_id: String,
    #[max_len(32)]
    pub event_name: String,
    pub attendee_count: u32,
    pub max_attendees: u32,
    pub is_active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AttendeePassport {
    pub owner: Pubkey,
    pub event: Pubkey,
    pub session_delegate: Pubkey,
    pub session_expiry: i64,
    #[max_len(32)]
    pub attendee_name: String,
    pub check_in_bits: u32,
    pub xp_points: u32,
    pub badge_claimed: bool,
    pub bump: u8,
}

// -----------------------------------------------------------------------------
// EVENTS & ERRORS
// -----------------------------------------------------------------------------

#[event]
pub struct EventInitialized {
    pub event_id: String,
    pub authority: Pubkey,
    pub max_attendees: u32,
    pub timestamp: i64,
}

#[event]
pub struct AttendeeRegistered {
    pub event_id: String,
    pub owner: Pubkey,
    pub delegate: Pubkey,
    pub name: String,
    pub timestamp: i64,
}

#[event]
pub struct CheckInRecorded {
    pub passport: Pubkey,
    pub booth_id: u8,
    pub total_xp: u32,
    pub timestamp: i64,
}

#[event]
pub struct BadgeAwarded {
    pub passport: Pubkey,
    pub owner: Pubkey,
    pub total_xp: u32,
    pub timestamp: i64,
}

#[error_code]
pub enum BreakpointError {
    #[msg("Event ID string exceeds max length of 16 characters")]
    EventIdTooLong,
    #[msg("Name string exceeds max length of 32 characters")]
    NameTooLong,
    #[msg("Session delegate expiration timestamp must be in the future")]
    InvalidSessionExpiry,
    #[msg("This Breakpoint event is currently inactive")]
    EventInactive,
    #[msg("Maximum attendee capacity reached for this event")]
    EventCapacityReached,
    #[msg("Unauthorized signer for this passport operation")]
    UnauthorizedSigner,
    #[msg("Session delegate authorization has expired")]
    SessionExpired,
    #[msg("Booth ID is outside allowed range (0..31)")]
    InvalidBoothId,
    #[msg("Attendee has already checked in to this booth")]
    AlreadyCheckedIn,
    #[msg("Attendee has not completed the required number of checkpoints")]
    InsufficientCheckins,
    #[msg("Completion badge has already been claimed")]
    BadgeAlreadyClaimed,
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
}