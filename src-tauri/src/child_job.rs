use std::os::windows::io::AsRawHandle;
use std::process::Child;
use std::sync::OnceLock;

use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

/// A kill-on-close job for helper processes. Its handle is never closed: Windows closes it when
/// Hodeum exits, even by crash or Task Manager, which kills every process in it.
#[derive(Default)]
pub struct ChildJob(OnceLock<Result<isize, String>>);

fn kill_on_close_job() -> Result<isize, String> {
    // SAFETY: the info struct is fully initialized and its exact size is passed.
    unsafe {
        let job = CreateJobObjectW(None, None).map_err(|e| format!("couldn't create a job object: {e}"))?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(), size)
            .map_err(|e| format!("couldn't configure the job object: {e}"))?;
        Ok(job.0 as isize)
    }
}

impl ChildJob {
    /// Ties `child`'s lifetime to Hodeum's. `name` appears in the error.
    pub fn bind(&self, child: &Child, name: &str) -> Result<(), String> {
        let job = self.0.get_or_init(kill_on_close_job).clone()?;
        // SAFETY: both handles are valid for this call; the child handle is owned by `child`.
        unsafe { AssignProcessToJobObject(HANDLE(job as *mut _), HANDLE(child.as_raw_handle())) }
            .map_err(|e| format!("couldn't tie {name} to Hodeum: {e}"))
    }
}
