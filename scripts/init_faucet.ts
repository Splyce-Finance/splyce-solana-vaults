import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Faucet } from "../target/types/faucet";
import * as fs from 'fs'; // Import fs module
import * as path from 'path'; // Import path module
import * as token from "@solana/spl-token";

// Define the config function
async function main() {
    try {
        const provider = anchor.AnchorProvider.env();
        anchor.setProvider(provider);

        const secretKeyPath = path.resolve(process.env.HOME, '.config/solana/id.json');
        const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
        const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
        const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

        console.log("Admin public key:", admin.publicKey.toBase58());

        let faucetProgram: Program<Faucet> = anchor.workspace.Faucet;
        console.log("Faucet program ID:", faucetProgram.programId.toBase58());

        const underlyingMint = new anchor.web3.PublicKey("CWduyZkkj34f5YntKwD7NjkHaRt7kfiScopgEqu9RR6W");
    
        const faucetData = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("data")],
          faucetProgram.programId
        )[0];
    
        console.log("Faucet data public key:", faucetData.toBase58());
    
        const faucetTokenAccount = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("underlying")],
          faucetProgram.programId
        )[0];
    
        console.log("Faucet token account public key:", faucetTokenAccount.toBase58());

        await faucetProgram.methods.initialize()
        .accounts({
          underlyingMint,
          signer: admin.publicKey,
        })
        .signers([admin])
        .rpc();

        await token.mintTo(provider.connection, admin, underlyingMint, faucetTokenAccount, admin, BigInt(1_000_000_000) * BigInt(1_000_000_000));

        console.log("Minted tokens to the faucet token account");
        // check the balance of the faucet token account
        const acc = await token.getAccount(provider.connection, faucetTokenAccount);
        console.log("Faucet token account balance:", acc.amount.toString());

    } catch (error) {
        console.error("Error occurred:", error);
    }
}

// Run the config function
main().catch((err) => {
    console.error(err);
    process.exit(1);
});