import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BreakpointStarterPack } from "../target/types/breakpoint_starter_pack";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("breakpoint_starter_pack test suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BreakpointStarterPack as Program<BreakpointStarterPack>;
  const authority = provider.wallet as anchor.Wallet;

  const eventId = "BREAKPOINT2025";
  const eventName = "Solana Breakpoint London";
  const maxCapacity = 5;

  let eventPda: PublicKey;
  let eventBump: number;

  const attendeeOne = Keypair.generate();
  const attendeeTwo = Keypair.generate();

  let passPdaOne: PublicKey;
  let passPdaTwo: PublicKey;

  before(async () => {
    [eventPda, eventBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("event"), Buffer.from(eventId)],
      program.programId
    );

    [passPdaOne] = PublicKey.findProgramAddressSync(
      [Buffer.from("pass"), eventPda.toBuffer(), attendeeOne.publicKey.toBuffer()],
      program.programId
    );

    [passPdaTwo] = PublicKey.findProgramAddressSync(
      [Buffer.from("pass"), eventPda.toBuffer(), attendeeTwo.publicKey.toBuffer()],
      program.programId
    );
  });

  it("1. Successfully initializes the Breakpoint London Event account", async () => {
    const tx = await program.methods
      .initializeEvent(eventId, eventName, maxCapacity)
      .accounts({
        event: eventPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    expect(tx).to.be.a("string");

    const eventAccount = await program.account.eventAccount.fetch(eventPda);
    expect(eventAccount.eventId).to.equal(eventId);
    expect(eventAccount.name).to.equal(eventName);
    expect(eventAccount.maxCapacity).to.equal(maxCapacity);
    expect(eventAccount.totalRegistered).to.equal(0);
    expect(eventAccount.totalCheckedIn).to.equal(0);
    expect(eventAccount.isActive).to.be.true;
    expect(eventAccount.authority.toBase58()).to.equal(authority.publicKey.toBase58());
  });

  it("2. Registers an attendee pass with Hacker tier", async () => {
    const metadataUri = "https://solanabreakpoint.io/metadata/hacker-badge.json";

    await program.methods
      .registerPass({ hacker: {} }, metadataUri)
      .accounts({
        event: eventPda,
        pass: passPdaOne,
        attendee: attendeeOne.publicKey,
        payer: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const pass = await program.account.passAccount.fetch(passPdaOne);
    expect(pass.attendee.toBase58()).to.equal(attendeeOne.publicKey.toBase58());
    expect(pass.metadataUri).to.equal(metadataUri);
    expect(pass.isCheckedIn).to.be.false;
    expect(pass.perksClaimedMask.toNumber()).to.equal(0);

    const event = await program.account.eventAccount.fetch(eventPda);
    expect(event.totalRegistered).to.equal(1);
  });

  it("3. Fails when attendee tries to claim perk BEFORE gate check-in", async () => {
    try {
      await program.methods
        .claimPerk(0) // Swag bag perk
        .accounts({
          event: eventPda,
          pass: passPdaOne,
          attendee: attendeeOne.publicKey,
        })
        .signers([attendeeOne])
        .rpc();
      expect.fail("Should have thrown MustBeCheckedInToClaimPerk");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("MustBeCheckedInToClaimPerk");
    }
  });

  it("4. Successfully checks in attendee via authorized venue gate authority", async () => {
    await program.methods
      .checkIn()
      .accounts({
        event: eventPda,
        pass: passPdaOne,
        authority: authority.publicKey,
      })
      .rpc();

    const pass = await program.account.passAccount.fetch(passPdaOne);
    expect(pass.isCheckedIn).to.be.true;
    expect(pass.checkInTimestamp.toNumber()).to.be.greaterThan(0);

    const event = await program.account.eventAccount.fetch(eventPda);
    expect(event.totalCheckedIn).to.equal(1);
  });

  it("5. Rejects double check-in attempt (Anti-pass-back)", async () => {
    try {
      await program.methods
        .checkIn()
        .accounts({
          event: eventPda,
          pass: passPdaOne,
          authority: authority.publicKey,
        })
        .rpc();
      expect.fail("Should have thrown AlreadyCheckedIn");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("AlreadyCheckedIn");
    }
  });

  it("6. Allows checked-in attendee to claim perk slot #0 (Breakout Swag Pack)", async () => {
    await program.methods
      .claimPerk(0)
      .accounts({
        event: eventPda,
        pass: passPdaOne,
        attendee: attendeeOne.publicKey,
      })
      .signers([attendeeOne])
      .rpc();

    const pass = await program.account.passAccount.fetch(passPdaOne);
    // Bit 0 set = 1
    expect(pass.perksClaimedMask.toNumber()).to.equal(1);
  });

  it("7. Rejects duplicate perk claim for identical perk slot", async () => {
    try {
      await program.methods
        .claimPerk(0)
        .accounts({
          event: eventPda,
          pass: passPdaOne,
          attendee: attendeeOne.publicKey,
        })
        .signers([attendeeOne])
        .rpc();
      expect.fail("Should have failed on duplicate perk claim");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("PerkAlreadyClaimed");
    }
  });

  it("8. Allows claiming an orthogonal perk slot #3 (Hardware Wallet VIP Perk)", async () => {
    await program.methods
      .claimPerk(3)
      .accounts({
        event: eventPda,
        pass: passPdaOne,
        attendee: attendeeOne.publicKey,
      })
      .signers([attendeeOne])
      .rpc();

    const pass = await program.account.passAccount.fetch(passPdaOne);
    // Bit 0 and Bit 3 set = (1 << 0) | (1 << 3) = 1 + 8 = 9
    expect(pass.perksClaimedMask.toNumber()).to.equal(9);
  });

  it("9. Rejects unauthorized party attempting to check in pass", async () => {
    const maliciousAuthority = Keypair.generate();

    // Register attendee two
    await program.methods
      .registerPass({ general: {} }, "https://solanabreakpoint.io/gen.json")
      .accounts({
        event: eventPda,
        pass: passPdaTwo,
        attendee: attendeeTwo.publicKey,
        payer: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .checkIn()
        .accounts({
          event: eventPda,
          pass: passPdaTwo,
          authority: maliciousAuthority.publicKey,
        })
        .signers([maliciousAuthority])
        .rpc();
      expect.fail("Should have failed with unauthorized authority");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("UnauthorizedAuthority");
    }
  });
});