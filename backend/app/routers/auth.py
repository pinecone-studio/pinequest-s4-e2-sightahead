from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from app.models.entities import UserProfile
from app.services import session_service
from app.services.auth_service import get_current_user


router = APIRouter(prefix="/auth", tags=["auth"])


# --- Firebase / Google login (schema branch) ---

@router.get("/me", response_model=UserProfile)
def read_current_user(current_user: UserProfile = Depends(get_current_user)) -> UserProfile:
    return current_user


@router.post("/sync", response_model=UserProfile)
def sync_current_user(current_user: UserProfile = Depends(get_current_user)) -> UserProfile:
    return current_user


# --- Guest / tester sessions (no Firebase required) ---

@router.post("/guest", response_model=UserProfile)
def create_guest_session(response: Response) -> UserProfile:
    session = session_service.create_guest_session()
    # SameSite=None is required because frontend and backend are always
    # different origins here (Vercel <-> Render, or localhost:3000 <->
    # 127.0.0.1:8000 in dev), and SameSite=None requires Secure. That means
    # this cookie only round-trips over real HTTPS — it works against the
    # deployed Render backend, but NOT against a local backend served over
    # plain http://127.0.0.1:8000 (browsers withhold Secure cookies on any
    # non-HTTPS connection; there is no localhost exception for this, unlike
    # for "powerful feature" APIs). Test guest sessions against the deployed
    # backend, or run local dev over HTTPS, to exercise this flow.
    response.set_cookie(
        key="session_id",
        value=session.session_id,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=60 * 60 * 24 * 30,
    )
    return UserProfile(id=session.session_id, display_name="Guest", is_guest=True)


# --- Email/password auth (EXTENSION POINT, not yet implemented) ---

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/register")
async def register(request: RegisterRequest):
    return {"message": "Auth not yet implemented"}


@router.post("/login")
async def login(request: LoginRequest):
    return {"message": "Auth not yet implemented"}


@router.post("/logout")
async def logout():
    return {"message": "Auth not yet implemented"}
