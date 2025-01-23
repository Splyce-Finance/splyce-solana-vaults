use anchor_lang::prelude::*;

use crate::state::UserRole;

pub trait UserRoleAccInfo {
    fn deserialize(&self) -> Result<Box<UserRole>>;
    fn has_role(&self) -> bool;
}

impl<'a> UserRoleAccInfo for AccountInfo<'a> {
    fn deserialize(&self) -> Result<Box<UserRole>> {
        let data = self.try_borrow_data()?;
        Ok(Box::new(UserRole::try_from_slice(&data[8..]).unwrap()))
    }

    fn has_role(&self) -> bool {
        let data = self.try_borrow_data().unwrap();
        if data.len() == 0 {
            return false;
        }
        let roles = UserRole::try_from_slice(&data[8..]);
        if roles.is_err() {
            return false;
        }
        roles.unwrap().has_role
    }
}