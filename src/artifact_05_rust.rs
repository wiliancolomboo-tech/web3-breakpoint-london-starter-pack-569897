use anchor_lang::prelude::*;

#[error_code]
pub enum StarterPackError {
    #[msg("The event name exceeds the maximum allowed length of 64 bytes.")]
    EventNameTooLong,
    #[msg("Event registration is currently frozen or inactive.")]
    EventInactive,
    #[msg("This attendee has already claimed their Breakpoint starter pack.")]
    AlreadyClaimed,
    #[msg("Insufficient funds in perk treasury vault.")]
    InsufficientVaultBalance,
    #[msg("Numerical overflow detected during calculation.")]
    NumericalOverflow,
    #[msg("Unauthorized: Caller is not the designated event administrator.")]
    UnauthorizedAdmin,
}