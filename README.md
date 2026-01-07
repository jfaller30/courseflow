# CourseFlow: Interactive Curriculum Planning and Advising Tool

CourseFlow is a browser-based interactive curriculum planning and advising application for computing programs. It represents curriculum requirements as an executable dependency graph and allows users to construct, validate, and document academic plans against institution-specific degree rules.

The system is designed to support both student-facing exploration and advisor-facing validation, while operating entirely client-side for privacy and ease of deployment.

 **Live Demo Site:** https://courseflow-one.vercel.app/

---

## Citation

If you use or reference CourseFlow in academic work, please cite the accompanying publication:

K. Faller II, “CourseFlow: An Interactive Flowchart System for Understanding Complex Degree Requirements,” Computer Applications in Engineering Education, Wiley, 2026 [Submitted]

---

## Technology Stack

- **Frontend:** React + Vite  
- **Visualization:** SVG + custom layout logic  
- **Deployment:** Vercel  
- **Optional Storage:** Vercel Blob  
- **Build System:** Node.js / npm  

---

## Installation (Local Development)

### Prerequisites

- Node.js v18 or later  
- npm (included with Node)

### Clone and Install

```bash
git clone https://github.com/jfaller30/courseflow.git
cd courseflow
npm install
````

---

## Blob-Hosted Documents

CourseFlow loads curriculum, course, and advising documents from an external document directory referred to as the *blob directory*. These documents are not bundled into the application at build time; instead, they are loaded by path at runtime from a configurable base URL.

The repository includes a `blobs/` directory containing the required documents with the following structure:

```
blobs/
  configs/
  courses/
  notes/
```

* **`configs/`**
  Program- and curriculum-level configuration files defining degree requirements, course groupings, and validation rules. These files serve as authoritative inputs for constructing the executable curriculum graph.

* **`courses/`**
  Course metadata files, including course identifiers, titles, unit values, prerequisite/corequisite relationships, and offering constraints. These documents populate the visual course map and support dependency checking.

* **`notes/`**
  Supplemental advising and documentation artifacts used to annotate plans or provide contextual information during advising review.

The application loads these documents by fixed paths at runtime. **Directory names and hierarchy must be preserved exactly** in all environments.

The base location of this directory is specified using an environment variable.

---

## Environment Variables

CourseFlow uses a single environment variable to determine the base location from which blob-hosted documents are loaded.

Create a `.env.local` file in the project root:

```bash
VITE_BLOB_URL=<base-url-for-blobs>
```

* `VITE_BLOB_URL` specifies the **base URL** corresponding to the root of the `blobs/` directory.
* All environment variables must be prefixed with `VITE_` to be accessible in the client.

---

## Run Locally

When running locally, the `blobs/` directory is served using a local static file server that mirrors the production blob layout.

1. Serve the `blobs/` directory:

```bash
npx serve blobs
```

This will expose the directory at a local URL (e.g., `http://localhost:3000`).

2. Point the application to the local blob directory by setting the environment variable:

```bash
VITE_BLOB_URL=http://localhost:3000
```

3. Start the development server:

```bash
npm run dev
```

The application will be available at:

```
http://localhost:5173
```

Because the same directory structure and document paths are used locally and in production, no code changes are required when switching environments.

---

## Deployment on Vercel

### 1. Push to GitHub

Ensure the repository is pushed to GitHub.

### 2. Import into Vercel

* Go to [https://vercel.com](https://vercel.com)
* Import the GitHub repository
* Framework preset: **Vite**
* Build command: `npm run build`
* Output directory: `dist`

### 3. Enable Vercel Blob Storage

* In the Vercel dashboard, enable **Blob Storage** for the project
* A Blob database is required for document loading in production

### 4. Upload Blob Documents

Upload the contents of the repository’s `blobs/` directory to Vercel Blob, **preserving the exact folder structure**:

```
configs/
courses/
notes/
```

The runtime application assumes this directory structure when loading documents.

### 5. Configure Environment Variable

In the Vercel dashboard:

* Go to **Project Settings → Environment Variables**
* Add:

```
VITE_BLOB_URL
```

Set its value to the base URL of the configured Vercel Blob storage.

### 6. Deploy

Vercel will automatically deploy the application on each push to the main branch.

---

## Privacy & Data Handling

* All computation is performed client-side
* No student data is sent to or stored on a server
* Blob storage contains only static documents and serialized plan state
* No authentication, tracking, or analytics are required

---

## Repository Structure

```
blobs/
  configs/          # Configuration documents (e.g., category colors)
  courses/          # Course data spreadsheets and datasets
  notes/            # Advising notes and documentation artifacts

public/             # Static public assets
  CourseFlow_Handout.docx
  CourseFlow_Handout.pdf
  manifest.json
  courseflow_logo*.png
  favicon.ico

src/
  App.jsx           # Application entry UI
  ProgramMap.jsx    # Main interactive program map
  graph/            # Graph construction, routing, and validation logic
  tda/              # Degree audit (TDA) import and parsing utilities
  docx/             # DOCX generation utilities for advising exports
  tests/            # Automated tests
  main.jsx          # React bootstrap
  *.css             # Styling
```

---