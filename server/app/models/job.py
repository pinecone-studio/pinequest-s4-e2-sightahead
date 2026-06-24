#what a job looks like

from pydantic import BaseModel
from typing import Optional

class TranscribeRequest(BaseModel):
    url: str
    language: Optional[str] = None
    
class Segment(BaseModel):
    start: float
    end: float
    text: str
    
class JobResult(BaseModel):
    job_id: str
    language: str
    language_probability: float
    segments: list[Segment]