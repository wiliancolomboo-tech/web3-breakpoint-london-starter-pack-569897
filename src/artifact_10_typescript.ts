import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("breakpoint_pass e2e integration suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Load IDL dynamically or instantiate against local validator
  const program = anchor.workspace.BreakpointPass as Program<any>;

  const eventSlug = "breakpoint-london-2025";
  const ticketCap = 2500;
  const sponsorFeePerMint = new anchor.BN(0.002 * LAMPORTS_PER_SOL); // 0.002 SOL subsidy

  const authority = Keypair.generate();
  const relayerPayer = Keypair.generate();
  const attendee = Keypair.generate();
  const verifier = Keypair.generate();

  let eventConfigPDA: PublicKey;
  let gasEscrowPDA: PublicKey;
  let passPDA: PublicKey;

  before(async () => {
    // Airdrop funds to authority, relayer and verifier
    for (const kp of [authority, relayerPayer, verifier]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({
        signature: sig,
        ...latestBlockhash,
      });
    }

    [eventConfigPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("event_config"), Buffer.from(eventSlug)],
      program.programId
    );

    [gasEscrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("gas_escrow"), eventConfigPDA.toBuffer()],
      program.programId
    );

    [passPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("pass"), eventConfigPDA.toBuffer(), attendee.publicKey.toBuffer()],
      program.programId
    );
  });

  it("1. Initializes the Breakpoint London Event Configuration", async () => {
    await program.methods
      .initializeEvent(eventSlug, ticketCap, sponsorFeePerMint)
      .accounts({
        eventConfig: eventConfigPDA,
        gasEscrow: gasEscrowPDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const configAccount = await program.account.eventConfig.fetch(eventConfigPDA);
    expect(configAccount.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(configAccount.eventSlug).to.equal(eventSlug);
    expect(configAccount.ticketCap).to.equal(ticketCap);
    expect(configAccount.ticketsIssued).to.equal(0);
    expect(configAccount.isActive).to.be.true;
  });

  it("2. Funds the Paymaster Gas Escrow with 2.0 SOL", async () => {
    const fundAmount = new anchor.BN(2 * LAMPORTS_PER_SOL);

    await program.methods
      .fundPaymaster(fundAmount)
      .accounts({
        eventConfig: eventConfigPDA,
        authority: authority.publicKey,
        funder: authority.publicKey,
        gasEscrow: gasEscrowPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const escrowBalance = await provider.connection.getBalance(gasEscrowPDA);
    expect(escrowBalance).to.be.at.least(2 * LAMPORTS_PER_SOL);
  });

  it("3. Successfully mints a sponsored pass (Attendee has 0 SOL)", async () => {
    const attendeeInitialBalance = await provider.connection.getBalance(attendee.publicKey);
    expect(attendeeInitialBalance).to.equal(0);

    const relayerBalanceBefore = await provider.connection.getBalance(relayerPayer.publicKey);

    await program.methods
      .mintPassSponsored(
        "Mert Mumtaz",
        "https://arweave.net/mock-credential-uri",
        { hacker: {} }
      )
      .accounts({
        eventConfig: eventConfigPDA,
        pass: passPDA,
        attendee: attendee.publicKey,
        relayerPayer: relayerPayer.publicKey,
        gasEscrow: gasEscrowPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([attendee, relayerPayer])
      .rpc();

    // Verify Pass Account State
    const pass = await program.account.passAccount.fetch(passPDA);
    expect(pass.owner.toBase58()).to.equal(attendee.publicKey.toBase58());
    expect(pass.attendeeName).to.equal("Mert Mumtaz");
    expect(pass.checkedIn).to.be.false;

    // Verify Attendee spent zero SOL
    const attendeeFinalBalance = await provider.connection.getBalance(attendee.publicKey);
    expect(attendeeFinalBalance).to.equal(0);

    // Verify Relayer was reimbursed
    const relayerBalanceAfter = await provider.connection.getBalance(relayerPayer.publicKey);
    expect(relayerBalanceAfter).to.be.greaterThan(
      relayerBalanceBefore - 0.005 * LAMPORTS_PER_SOL
    );
  });

  it("4. Prevents duplicate mints for the same attendee (PDA Collision Guard)", async () => {
    try {
      await program.methods
        .mintPassSponsored(
          "Duplicate Attacker",
          "https://arweave.net/duplicate",
          { hacker: {} }
        )
        .accounts({
          eventConfig: eventConfigPDA,
          pass: passPDA,
          attendee: attendee.publicKey,
          relayerPayer: relayerPayer.publicKey,
          gasEscrow: gasEscrowPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([attendee, relayerPayer])
        .rpc();
      expect.fail("Should have failed with account already in use");
    } catch (err: any) {
      expect(err.toString()).to.include("already in use");
    }
  });

  it("5. Verifies and checks-in attendee at the venue door", async () => {
    await program.methods
      .checkInAttendee()
      .accounts({
        eventConfig: eventConfigPDA,
        authority: authority.publicKey,
        verifier: verifier.publicKey,
        pass: passPDA,
      })
      .signers([authority, verifier])
      .rpc();

    const pass = await program.account.passAccount.fetch(passPDA);
    expect(pass.checkedIn).to.be.true;
  });

  it("6. Rejects check-in if pass is already consumed", async () => {
    try {
      await program.methods
        .checkInAttendee()
        .accounts({
          eventConfig: eventConfigPDA,
          authority: authority.publicKey,
          verifier: verifier.publicKey,
          pass: passPDA,
        })
        .signers([authority, verifier])
        .rpc();
      expect.fail("Should have rejected already checked-in pass");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("AlreadyCheckedIn");
    }
  });
});