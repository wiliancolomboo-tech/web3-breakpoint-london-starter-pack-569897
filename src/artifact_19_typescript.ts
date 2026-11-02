import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BreakpointPass } from "../target/types/breakpoint_pass";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("Breakpoint London Pass Engine - Comprehensive QA Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BreakpointPass as Program<BreakpointPass>;
  const eventName = "BreakpointLondon";
  const capacity = 5000;
  const ticketPrice = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

  let eventConfigPda: PublicKey;
  let eventConfigBump: number;

  const authority = provider.wallet as anchor.Wallet;
  const gatekeeper = Keypair.generate();
  const attendee = Keypair.generate();
  const attendeeTwo = Keypair.generate();

  let attendeePassPda: PublicKey;

  before(async () => {
    // Fund test attendee accounts
    const airdropTx1 = await provider.connection.requestAirdrop(attendee.publicKey, 2 * LAMPORTS_PER_SOL);
    const airdropTx2 = await provider.connection.requestAirdrop(attendeeTwo.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropTx1);
    await provider.connection.confirmTransaction(airdropTx2);

    [eventConfigPda, eventConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("event_config"), Buffer.from(eventName)],
      program.programId
    );

    [attendeePassPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("attendee_pass"), eventConfigPda.toBuffer(), attendee.publicKey.toBuffer()],
      program.programId
    );
  });

  it("1. Successfully initializes Breakpoint event configuration", async () => {
    await program.methods
      .initializeEvent(eventName, capacity, ticketPrice)
      .accounts({
        eventConfig: eventConfigPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const eventAccount = await program.account.eventConfig.fetch(eventConfigPda);
    expect(eventAccount.eventName).to.equal(eventName);
    expect(eventAccount.capacity).to.equal(capacity);
    expect(eventAccount.issuedTickets).to.equal(0);
    expect(eventAccount.checkedInCount).to.equal(0);
    expect(eventAccount.ticketPriceLamports.toString()).to.equal(ticketPrice.toString());
  });

  it("2. Rejects re-initialization with same seed (anti-griefing)", async () => {
    try {
      await program.methods
        .initializeEvent(eventName, capacity, ticketPrice)
        .accounts({
          eventConfig: eventConfigPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have failed to re-initialize identical PDA");
    } catch (err: any) {
      expect(err.toString()).to.include("already in use");
    }
  });

  it("3. Issues an Attendee Pass with lamport transfer to authority", async () => {
    const preBal = await provider.connection.getBalance(authority.publicKey);

    await program.methods
      .issuePass(2, "Alice Solana") // Tier 2 = VIP
      .accounts({
        eventConfig: eventConfigPda,
        attendeePass: attendeePassPda,
        attendee: attendee.publicKey,
        eventAuthority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([attendee])
      .rpc();

    const postBal = await provider.connection.getBalance(authority.publicKey);
    expect(postBal - preBal).to.equal(ticketPrice.toNumber());

    const pass = await program.account.attendeePass.fetch(attendeePassPda);
    expect(pass.attendee.toBase58()).to.equal(attendee.publicKey.toBase58());
    expect(pass.tier).to.equal(2);
    expect(pass.isCheckedIn).to.be.false;
    expect(pass.swagClaimedMask).to.equal(0);

    const event = await program.account.eventConfig.fetch(eventConfigPda);
    expect(event.issuedTickets).to.equal(1);
  });

  it("4. Prevents duplicate pass issuance to the same wallet", async () => {
    try {
      await program.methods
        .issuePass(0, "Alice Clone")
        .accounts({
          eventConfig: eventConfigPda,
          attendeePass: attendeePassPda,
          attendee: attendee.publicKey,
          eventAuthority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([attendee])
        .rpc();
      expect.fail("Double minting should have failed");
    } catch (err: any) {
      expect(err.toString()).to.include("already in use");
    }
  });

  it("5. Gatekeeper executes successful check-in", async () => {
    await program.methods
      .verifyCheckIn()
      .accounts({
        eventConfig: eventConfigPda,
        attendeePass: attendeePassPda,
        gatekeeper: gatekeeper.publicKey,
      })
      .signers([gatekeeper])
      .rpc();

    const pass = await program.account.attendeePass.fetch(attendeePassPda);
    expect(pass.isCheckedIn).to.be.true;
    expect(pass.checkInTimestamp.toNumber()).to.be.greaterThan(0);

    const event = await program.account.eventConfig.fetch(eventConfigPda);
    expect(event.checkedInCount).to.equal(1);
  });

  it("6. Rejects double check-in attempt", async () => {
    try {
      await program.methods
        .verifyCheckIn()
        .accounts({
          eventConfig: eventConfigPda,
          attendeePass: attendeePassPda,
          gatekeeper: gatekeeper.publicKey,
        })
        .signers([gatekeeper])
        .rpc();
      expect.fail("Should reject second check-in attempt");
    } catch (err: any) {
      expect(err.toString()).to.include("AlreadyCheckedIn");
    }
  });

  it("7. Redeems swag item #1 (T-Shirt) via bitwise masking", async () => {
    const SHIRT_MASK = 0b00000001; // 1

    await program.methods
      .claimSwag(SHIRT_MASK)
      .accounts({
        attendeePass: attendeePassPda,
        attendee: attendee.publicKey,
      })
      .signers([attendee])
      .rpc();

    const pass = await program.account.attendeePass.fetch(attendeePassPda);
    expect(pass.swagClaimedMask).to.equal(SHIRT_MASK);
  });

  it("8. Rejects double-redemption of swag item #1", async () => {
    const SHIRT_MASK = 0b00000001; // 1

    try {
      await program.methods
        .claimSwag(SHIRT_MASK)
        .accounts({
          attendeePass: attendeePassPda,
          attendee: attendee.publicKey,
        })
        .signers([attendee])
        .rpc();
      expect.fail("Double claiming should fail");
    } catch (err: any) {
      expect(err.toString()).to.include("SwagAlreadyClaimed");
    }
  });

  it("9. Permits subsequent claim of swag item #2 (Backpack)", async () => {
    const BACKPACK_MASK = 0b00000010; // 2

    await program.methods
      .claimSwag(BACKPACK_MASK)
      .accounts({
        attendeePass: attendeePassPda,
        attendee: attendee.publicKey,
      })
      .signers([attendee])
      .rpc();

    const pass = await program.account.attendeePass.fetch(attendeePassPda);
    expect(pass.swagClaimedMask).to.equal(0b00000011); // Both 1 and 2 claimed
  });
});