import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BreakpointLondonPack } from "../target/types/breakpoint_london_pack";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

describe("Breakpoint London Starter Pack - Integration & Security Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BreakpointLondonPack as Program<BreakpointLondonPack>;

  const admin = Keypair.generate();
  const sponsor = Keypair.generate();
  const hackerA = Keypair.generate();
  const hackerB = Keypair.generate();
  const treasury = Keypair.generate();

  let badgeMint: PublicKey;
  let usdcToken2022Mint: PublicKey;
  let sponsorUsdcAta: PublicKey;
  let hackerABadgeAta: PublicKey;
  let hackerAUsdcAta: PublicKey;
  let hackerBUsdcAta: PublicKey;

  let configPda: PublicKey;
  let configBump: number;
  let vaultPda: PublicKey;
  let vaultBump: number;
  let vaultTokenAta: PublicKey;

  const eventId = new anchor.BN(202411);
  const trackId = 1; // Track 1: DeFi & Payments Infrastructure
  const depositAmount = new anchor.BN(50_000 * 10 ** 6); // 50,000 Token-2022 units

  before(async () => {
    // Airdrop SOL to test actors
    for (const actor of [admin, sponsor, hackerA, hackerB]) {
      const sig = await provider.connection.requestAirdrop(actor.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }

    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("global-config")],
      program.programId
    );

    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("bounty-vault"), Buffer.from([trackId])],
      program.programId
    );

    // Create Token-2022 badge mint owned by configPda authority
    badgeMint = await createMint(
      provider.connection,
      admin,
      configPda,
      null,
      0,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create Token-2022 stablecoin mock mint owned by Sponsor
    usdcToken2022Mint = await createMint(
      provider.connection,
      sponsor,
      sponsor.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Setup Token Accounts
    sponsorUsdcAta = await createAssociatedTokenAccount(
      provider.connection,
      sponsor,
      usdcToken2022Mint,
      sponsor.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    hackerABadgeAta = await createAssociatedTokenAccount(
      provider.connection,
      hackerA,
      badgeMint,
      hackerA.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    hackerAUsdcAta = await createAssociatedTokenAccount(
      provider.connection,
      hackerA,
      usdcToken2022Mint,
      hackerA.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    hackerBUsdcAta = await createAssociatedTokenAccount(
      provider.connection,
      hackerB,
      usdcToken2022Mint,
      hackerB.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Mint liquidity to sponsor
    await mintTo(
      provider.connection,
      sponsor,
      usdcToken2022Mint,
      sponsorUsdcAta,
      sponsor,
      100_000 * 10 ** 6,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("1. Initializes global protocol configuration with verified PDA seeds", async () => {
    const feeBps = 150; // 1.5%
    const delaySlots = new anchor.BN(5);

    await program.methods
      .initialize(feeBps, delaySlots)
      .accounts({
        config: configPda,
        admin: admin.publicKey,
        treasury: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const configAccount = await program.account.globalConfig.fetch(configPda);
    expect(configAccount.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(configAccount.protocolFeeBps).to.equal(150);
    expect(configAccount.isPaused).to.be.false;
  });

  it("2. Registers Hacker and mints Token-2022 Soulbound Attestation badge", async () => {
    const handleHash = crypto.createHash("sha256").update("hacker_crypto_london").digest();

    const [badgePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("attendee-badge"), eventId.toArrayLike(Buffer, "le", 8), hackerA.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerHacker(eventId, Array.from(handleHash))
      .accounts({
        hackerBadge: badgePda,
        config: configPda,
        badgeMint: badgeMint,
        badgeTokenAccount: hackerABadgeAta,
        hacker: hackerA.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([hackerA])
      .rpc();

    const badgeAccount = await program.account.attendeeBadge.fetch(badgePda);
    expect(badgeAccount.hacker.toBase58()).to.equal(hackerA.publicKey.toBase58());

    const tokenBalance = await getAccount(
      provider.connection,
      hackerABadgeAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(tokenBalance.amount)).to.equal(1);
  });

  it("3. Sponsor funds Track Bounty Vault with timelock protection", async () => {
    const currentSlot = await provider.connection.getSlot();
    const unlockSlot = new anchor.BN(currentSlot + 10);

    const vaultTokenAccount = anchor.utils.token.associatedAddress({
      mint: usdcToken2022Mint,
      owner: vaultPda,
    });
    vaultTokenAta = vaultTokenAccount;

    await program.methods
      .fundTrackVault(trackId, depositAmount, unlockSlot)
      .accounts({
        trackVault: vaultPda,
        vaultMint: usdcToken2022Mint,
        sponsorTokenAccount: sponsorUsdcAta,
        vaultTokenAccount: vaultTokenAta,
        sponsor: sponsor.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      })
      .signers([sponsor])
      .rpc();

    const vaultState = await program.account.trackVault.fetch(vaultPda);
    expect(vaultState.totalAllocation.toString()).to.equal(depositAmount.toString());
    expect(vaultState.remainingBalance.toString()).to.equal(depositAmount.toString());
  });

  it("4. Rejects prize distribution when timelock is active", async () => {
    const bpsSplit = [7000, 3000]; // 70% to 1st, 30% to 2nd

    try {
      await program.methods
        .disbursePrizes(trackId, bpsSplit)
        .accounts({
          config: configPda,
          trackVault: vaultPda,
          vaultMint: usdcToken2022Mint,
          vaultTokenAccount: vaultTokenAta,
          admin: admin.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: hackerAUsdcAta, isWritable: true, isSigner: false },
          { pubkey: hackerBUsdcAta, isWritable: true, isSigner: false },
        ])
        .signers([admin])
        .rpc();
      expect.fail("Disbursement should have failed due to active timelock");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("TimelockActive");
    }
  });

  it("5. Completes prize disbursement once timelock slots elapse", async () => {
    // Wait until unlock slot has passed
    let currentSlot = await provider.connection.getSlot();
    const vaultState = await program.account.trackVault.fetch(vaultPda);
    while (currentSlot <= vaultState.unlockSlot.toNumber()) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      currentSlot = await provider.connection.getSlot();
    }

    const bpsSplit = [7000, 3000]; // 70% (35,000) and 30% (15,000)

    await program.methods
      .disbursePrizes(trackId, bpsSplit)
      .accounts({
        config: configPda,
        trackVault: vaultPda,
        vaultMint: usdcToken2022Mint,
        vaultTokenAccount: vaultTokenAta,
        admin: admin.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: hackerAUsdcAta, isWritable: true, isSigner: false },
        { pubkey: hackerBUsdcAta, isWritable: true, isSigner: false },
      ])
      .signers([admin])
      .rpc();

    const winner1Account = await getAccount(provider.connection, hackerAUsdcAta, undefined, TOKEN_2022_PROGRAM_ID);
    const winner2Account = await getAccount(provider.connection, hackerBUsdcAta, undefined, TOKEN_2022_PROGRAM_ID);

    expect(Number(winner1Account.amount)).to.equal(35_000 * 10 ** 6);
    expect(Number(winner2Account.amount)).to.equal(15_000 * 10 ** 6);

    const postVaultState = await program.account.trackVault.fetch(vaultPda);
    expect(postVaultState.remainingBalance.toNumber()).to.equal(0);
  });

  it("6. Asserts circuit breaker halts unauthorized instructions", async () => {
    // Admin triggers circuit breaker
    await program.methods
      .setCircuitBreaker(true)
      .accounts({
        config: configPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    let config = await program.account.globalConfig.fetch(configPda);
    expect(config.isPaused).to.be.true;

    // Verify hacker registration is rejected while paused
    const handleHash = crypto.createHash("sha256").update("late_hacker").digest();
    const lateHacker = Keypair.generate();
    const [lateBadgePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("attendee-badge"), eventId.toArrayLike(Buffer, "le", 8), lateHacker.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .registerHacker(eventId, Array.from(handleHash))
        .accounts({
          hackerBadge: lateBadgePda,
          config: configPda,
          badgeMint: badgeMint,
          badgeTokenAccount: hackerABadgeAta,
          hacker: lateHacker.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([lateHacker])
        .rpc();
      expect.fail("Should fail due to active circuit breaker");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("ProtocolPaused");
    }

    // Reset circuit breaker
    await program.methods
      .setCircuitBreaker(false)
      .accounts({
        config: configPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();
  });
});