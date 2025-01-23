use uint::construct_uint;

// Define a 256-bit unsigned integer type (only need to define once)
construct_uint! {
    pub struct U256(4);
}

/// Computes the amount of asset to swap based on weight and total value.
pub fn compute_asset_per_swap(
    amount: u64,
    weight: u128,
    total_weight: u128,
) -> u64 {
    let amount_u256 = U256::from(amount);
    let weight_u256 = U256::from(weight);
    let total_weight_u256 = U256::from(total_weight);

    let amount_per_swap_u256 = amount_u256
        .checked_mul(weight_u256)
        .expect("Multiplication overflow in asset value computation")
        .checked_div(total_weight_u256)
        .expect("Division error in asset value computation");

    // Ensure the result fits into u64
    if amount_per_swap_u256 > U256::from(u64::MAX) {
        panic!("Overflow: amount per swap does not fit into u64");
    }

    amount_per_swap_u256.as_u64()
}

/// Computes the asset value using price and decimals.
pub fn compute_asset_value(
    asset_amount: u64,
    asset_price: u128,
    asset_decimals: u8,
) -> u128 {
    let asset_amount_u256 = U256::from(asset_amount);
    let asset_price_u256 = U256::from(asset_price);
    let asset_decimals_u256 = U256::from(asset_decimals);

    // Compute scaling factor: 10^(asset_decimals)
    let scaling_factor = U256::from(10).pow(asset_decimals_u256);

    // Calculate asset value: (asset_amount * asset_price) / 10^(asset_decimals)
    let asset_value_u256 = asset_amount_u256
        .checked_mul(asset_price_u256)
        .expect("Multiplication overflow in asset value computation")
        .checked_div(scaling_factor)
        .expect("Division error in asset value computation");

    // Ensure the result fits into u64
    if asset_value_u256 > U256::from(u64::MAX) {
        panic!("Overflow: asset value does not fit into u64");
    }

    asset_value_u256.as_u128()
}

/// Converts Orca's sqrt_price_x64 to price in underlying decimals.
pub fn get_price_in_underlying_decimals(
    sqrt_price_x64: u128,
    a_to_b_for_purchase: bool,
    a_decimals: u8,
    b_decimals: u8,
) -> u128 {
    let price = U256::from(sqrt_price_x64);
    let price_x128 = price * price;
    let scaling_factor = U256::from(1_000_000_000_000_000_000_000u128); // 1e21
    let mut price_x128_scaled = price_x128 * scaling_factor;
    price_x128_scaled = price_x128_scaled >> 64;
    price_x128_scaled = price_x128_scaled * scaling_factor;
    price_x128_scaled = price_x128_scaled >> 64;

    // Adjust for decimal differences between tokens
    price_x128_scaled = if a_decimals > b_decimals {
        price_x128_scaled * U256::from(10).pow(U256::from(a_decimals - b_decimals))
    } else if b_decimals > a_decimals {
        price_x128_scaled / U256::from(10).pow(U256::from(b_decimals - a_decimals))
    } else {
        price_x128_scaled
    };

    let usdc_decimals = if a_to_b_for_purchase { a_decimals } else { b_decimals };
    let invert = a_to_b_for_purchase;

    if invert {
        price_x128_scaled = price_x128_scaled * U256::from(10).pow(U256::from(usdc_decimals));
        price_x128_scaled = price_x128_scaled / U256::from(10).pow(U256::from(42));

        let scaling_factor = U256::from(1_000_000_000_000_000_000_000u128); // 1e21
        price_x128_scaled = scaling_factor / price_x128_scaled;
        price_x128_scaled = price_x128_scaled / U256::from(10).pow(U256::from(21 - 2 * usdc_decimals));
    } else {
        price_x128_scaled = price_x128_scaled * U256::from(10).pow(U256::from(usdc_decimals));
        price_x128_scaled = price_x128_scaled / U256::from(10).pow(U256::from(42));
    }

    price_x128_scaled.as_u128()
}
