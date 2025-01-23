use anchor_lang::prelude::*;

#[event]
pub struct PerformanceFeeUpdatedEvent {
    pub accountant_key: Pubkey, 
    pub performance_fee: u64,
}

#[event]
pub struct EntryFeeUpdatedEvent {
    pub accountant_key: Pubkey, 
    pub entry_fee: u64,
}

#[event]
pub struct RedemptionFeeUpdatedEvent {
    pub accountant_key: Pubkey, 
    pub redemption_fee: u64,
}