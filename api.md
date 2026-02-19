Below is the **PathPilot MVP API List**.
This is **clean, minimal, and academically correct** for your project.

---

# PathPilot — API List (MVP)

---

# 1. Authentication APIs

---

## 1. Register User

**Endpoint**

```
POST /api/auth/register
```

**Purpose**
Create new user account

**Request Body**

```
{
  name,
  email,
  password
}
```

**Response**

```
{
  message,
  token,
  userId
}
```

---

## 2. Login User

**Endpoint**

```
POST /api/auth/login
```

**Purpose**
Authenticate user

**Request Body**

```
{
  email,
  password
}
```

**Response**

```
{
  message,
  token,
  userId
}
```

---

# 2. Resume APIs

---

## 3. Upload Resume

**Endpoint**

```
POST /api/resume/upload
```

**Purpose**
Upload and process resume

**Request**
Form-Data:

```
resume: file
```

**Response**

```
{
  message,
  extractedSkills,
  extractedRole
}
```

---

## 4. Get Resume Data

**Endpoint**

```
GET /api/resume
```

**Purpose**
Fetch parsed resume

**Response**

```
{
  skills,
  role,
  experience
}
```

---

# 3. Job APIs

---

## 5. Get Job Recommendations

**Endpoint**

```
GET /api/jobs/match
```

**Purpose**
Get matched jobs

**Response**

```
[
  {
    jobId,
    title,
    company,
    matchScore
  }
]
```

---

## 6. Save Job

**Endpoint**

```
POST /api/jobs/save/:jobId
```

**Purpose**
Save job

**Response**

```
{
  message
}
```

---

## 7. Get Saved Jobs

**Endpoint**

```
GET /api/jobs/saved
```

**Purpose**
Fetch saved jobs

**Response**

```
[
  job objects
]
```

---

# 4. Interview APIs

---

## 8. Start Interview

**Endpoint**

```
POST /api/interview/start
```

**Purpose**
Create interview session

**Response**

```
{
  interviewId
}
```

---

## 9. Upload Interview Audio

**Endpoint**

```
POST /api/interview/upload
```

**Purpose**
Upload audio file

**Request**
Form-Data:

```
audio: file
interviewId
```

**Response**

```
{
  message
}
```

---

## 10. Get Interview Feedback

**Endpoint**

```
GET /api/interview/feedback/:interviewId
```

**Purpose**
Get feedback

**Response**

```
{
  transcript,
  feedback,
  wordsPerMinute
}
```

---

# 5. User API

---

## 11. Get User Profile

**Endpoint**

```
GET /api/user/profile
```

**Purpose**
Fetch user data

**Response**

```
{
  name,
  email,
  skills
}
```

---

# Complete API Summary Table

| Module    | APIs                    |
| --------- | ----------------------- |
| Auth      | register, login         |
| Resume    | upload, get             |
| Jobs      | match, save, saved      |
| Interview | start, upload, feedback |
| User      | profile                 |

---

# Total APIs in MVP

**11 APIs**

---

If you want next, I can give:

* Database schema
* Controller structure
* Folder structure
* API flow diagram
* Complete backend architecture

