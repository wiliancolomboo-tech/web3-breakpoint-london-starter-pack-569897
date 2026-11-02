use anchor_lang::prelude::*;
use crate::state::SessionRecord;

#[derive(Accounts)]
pub struct RevokeSession<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        close = authority,
        seeds = [
            SessionRecord::SEED_PREFIX,
            authority.key().as_ref(),
            session_record.session_signer.as_ref()
        ],
        bump = session_record.bump,
        has_one = authority
    )]
    pub session_record: Account<'info, SessionRecord>,
}

pub fn handler(_ctx: Context<RevokeSession>) -> Result<()> {
    // Session closed by Anchor runtime via `close = authority`, reclaiming rent lamports.
    Ok(())
}