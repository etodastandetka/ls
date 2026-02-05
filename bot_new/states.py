from aiogram.fsm.state import State, StatesGroup

class DepositStates(StatesGroup):
    bookmaker = State()
    player_id = State()
    amount = State()
    bank = State()
    receipt_photo = State()

class WithdrawStates(StatesGroup):
    bookmaker = State()
    phone = State()
    qr_photo = State()
    player_id = State()
    code = State()
    amount = State()

