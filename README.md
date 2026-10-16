MediTrac Server API
Overview
The MediTrac API is a RESTful backend service built for managing medication inventories, tracking pharmacy stock, and handling patient search requests.

Authentication
Note: Auth is currently mocked for testing.
Include the following header with all requests:
Authorization: Bearer mock-token-123

How to Run the API Locally
Follow these exact steps from a clean terminal:

Clone the repository and navigate to the project root:
git clone https://github.com/Antony101-tom/MEDITRAC-website-project.git
cd IAP_Team_2__2.2--webapp

Navigate to the server folder and install dependencies:
cd server
npm install

Start the server:
npm start

The API will start at http://localhost:5000.

Quickstart (Copy-Paste Test)
Run this single command in your terminal to verify the API is running:

curl -X GET http://localhost:5000/api/medications -H "Authorization: Bearer mock-token-123"

Major Endpoints Reference
### 1. GET /api/medications
Retrieve all medications.

* **Request:**
curl -X GET http://localhost:5000/api/medications

* **Success Response (200 OK):**
[
{
"id": "cd72c942-73cd-4723-8b7a-d60642148e26",
"pharmacy_id": "5bf2b70b-17b6-4f55-8720-2c393d945e4a",
"name": "Paracetamol 500 mg",
"form": "Tablets 10 x 10 pack",
"category": "Pain relief",
"quantity": 20,
"unit": "Boxes",
"price": 500,
"branch": "Hurlinghum"
}
]


### 2. POST /api/medications
Create a new medication entry.

* **Request:**
  curl -X POST http://localhost:5000/api/medications \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer mock-token-123" \
    -d "{\"name\": \"Amoxicillin 500mg\", \"form\": \"Capsule\", \"category\": \"Antibiotics\", \"quantity\": 50, \"unit\": \"Boxes\", \"price\": 350, \"branch\": \"Kilimani Branch\"}"

* **Success Response (201 Created):**
  {
    "id": "e8a91b2c-3d4e-5f6a-7b8c-9d0e1f2a3b4c",
    "name": "Amoxicillin 500mg",
    "form": "Capsule",
    "category": "Antibiotics",
    "quantity": 50,
    "unit": "Boxes",
    "price": 350,
    "branch": "Kilimani Branch"
  }

### 3. GET /api/medications/:id
Retrieve a single medication by ID.

* **Request:**
  curl -X GET http://localhost:5000/api/medications/cd72c942-73cd-4723-8b7a-d60642148e26

* **Success Response (200 OK):**
  {
    "id": "cd72c942-73cd-4723-8b7a-d60642148e26",
    "pharmacy_id": "5bf2b70b-17b6-4f55-8720-2c393d945e4a",
    "name": "Paracetamol 500 mg",
    "form": "Tablets 10 x 10 pack",
    "category": "Pain relief",
    "quantity": 20,
    "unit": "Boxes",
    "price": 500,
    "branch": "Hurlinghum"
  }

### 4. DELETE /api/medications/:id
Delete a medication by ID.

* **Request:**
  curl -X DELETE http://localhost:5000/api/medications/cd72c942-73cd-4723-8b7a-d60642148e26 \
    -H "Authorization: Bearer mock-token-123"

* **Success Response (200 OK / 204 No Content):**
  {
    "message": "Medication deleted successfully"
  }

  ### Error Response Reference
* **Not Found (404 Not Found):**
GET /api/medications/9999
{
"error": "Medication not found"
}
Returned when seraching for or modifying a medication ID that doesnt exist

* **Bad Request(400 Bad Request):**
Returned when creating a medication (POST /api/medications) with missing required fields:
{
"error": "Missing required field: name"
}

* **Unauthorised (401 Unauthorized):**
Returned when attempting protected requests without a valid bearer token header:
{
"error": "Unauthorized access. Missing or invalid Authorization token."
}
