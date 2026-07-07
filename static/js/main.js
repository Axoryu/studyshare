(() => {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Global search                                                       */
  /* ------------------------------------------------------------------ */

  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");
  const searchWrap = document.querySelector(".search-wrap");
  let searchDebounce = null;
  let searchAbort = null;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function pdfOrImageIcon(fileType) {
    if (fileType === "pdf") {
      return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    }
    return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  }

  function renderResults(results, query) {
    if (!query) {
      searchResults.hidden = true;
      searchResults.innerHTML = "";
      return;
    }
    if (results.length === 0) {
      searchResults.innerHTML = `<div class="search-empty">No files match "${escapeHtml(query)}"</div>`;
      searchResults.hidden = false;
      return;
    }
    searchResults.innerHTML = results
      .map(
        (r) => `
        <a class="search-result-item" href="/subject/${encodeURIComponent(r.subject_slug)}#file-${r.id}">
          <span class="search-result-icon">${pdfOrImageIcon(r.file_type)}</span>
          <span class="search-result-text">
            <span class="search-result-title">${escapeHtml(r.title)}</span>
            <span class="search-result-sub">${escapeHtml(r.subject_name)} · ${escapeHtml(r.uploaded_display)}</span>
          </span>
        </a>`
      )
      .join("");
    searchResults.hidden = false;
  }

  async function runSearch(query) {
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    searchResults.innerHTML = `<div class="search-loading">Searching…</div>`;
    searchResults.hidden = false;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: searchAbort.signal,
      });
      const data = await res.json();
      renderResults(data.results || [], query);
    } catch (err) {
      if (err.name !== "AbortError") {
        searchResults.innerHTML = `<div class="search-empty">Something went wrong. Try again.</div>`;
      }
    }
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.trim();
      clearTimeout(searchDebounce);
      if (!query) {
        renderResults([], "");
        return;
      }
      searchDebounce = setTimeout(() => runSearch(query), 180);
    });

    searchInput.addEventListener("focus", () => {
      if (searchInput.value.trim()) searchResults.hidden = false;
    });

    document.addEventListener("click", (e) => {
      if (searchWrap && !searchWrap.contains(e.target)) {
        searchResults.hidden = true;
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      }
      if (e.key === "Escape") {
        searchResults.hidden = true;
        searchInput.blur();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Upload modal                                                        */
  /* ------------------------------------------------------------------ */

  const overlay = document.getElementById("uploadOverlay");
  const openBtn = document.getElementById("openUploadBtn");
  const closeBtn = document.getElementById("closeUploadBtn");
  const form = document.getElementById("uploadForm");
  const dropzone = document.getElementById("dropzone");
  const dropzoneContent = document.getElementById("dropzoneContent");
  const fileInput = document.getElementById("fileInput");
  const formErrors = document.getElementById("formErrors");
  const submitBtn = document.getElementById("submitUploadBtn");
  const uploadProgressWrap = document.getElementById("uploadProgressWrap"); // New
  const uploadProgressBar = document.getElementById("uploadProgressBar");   // New
  const uploadProgressText = document.getElementById("uploadProgressText"); // New

  function openModal() {
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => document.getElementById("titleInput")?.focus(), 50);
  }

  function closeModal() {
    overlay.hidden = true;
    document.body.style.overflow = "";
    form.reset();
    resetDropzone();
    formErrors.hidden = true;
    formErrors.innerHTML = "";
    resetUploadProgress(); // Reset progress on close
  }

  function resetDropzone() {
    dropzoneContent.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <p><strong>Click to choose files</strong> or drag them here</p>
      <p class="dropzone-hint">JPG, PNG, WEBP, or PDF · up to 25 MB each</p>`;
  }

  function resetUploadProgress() { // New function
    uploadProgressWrap.hidden = true;
    uploadProgressBar.style.width = "0%";
    uploadProgressText.textContent = "";
  }

  openBtn?.addEventListener("click", openModal);
  closeBtn?.addEventListener("click", closeModal);
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay && !overlay.hidden) closeModal();
  });

  dropzone?.addEventListener("click", () => fileInput.click());
  dropzone?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone?.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files; // Handle multiple files from drop
    if (files.length > 0) {
      fileInput.files = files;
      showFileNames(files);
    }
  });

  fileInput?.addEventListener("change", () => {
    if (fileInput.files.length > 0) showFileNames(fileInput.files); // Handle multiple files from input
  });

  function showFileNames(files) { // Modified to show multiple file names
    if (files.length === 0) {
      resetDropzone();
      return;
    }
    let filenamesHtml = "";
    if (files.length === 1) {
      filenamesHtml = `<p class="dropzone-filename">${escapeHtml(files[0].name)}</p>`;
    }
    else {
      const fileList = Array.from(files).map(file => `<li>${escapeHtml(file.name)}</li>`).join('');
      filenamesHtml = `<p class="dropzone-filename">${files.length} files selected</p>
                       <ul style="max-height: 100px; overflow-y: auto; list-style: none; padding: 0; margin: 0; font-size: 13px; color: var(--text-muted);">${fileList}</ul>`;
    }

    dropzoneContent.innerHTML = `
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      ${filenamesHtml}
      <p class="dropzone-hint">Click to change files</p>`;
  }

  function showToast(message, isError = false) { // Modified to support error toasts
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.hidden = false;
    toast.style.backgroundColor = isError ? "rgba(255, 107, 107, 0.1)" : ""; // Basic error styling for toast
    toast.style.color = isError ? "#ffb3b3" : "";

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.hidden = true;
      toast.style.backgroundColor = ""; // Reset styles
      toast.style.color = "";           // Reset styles
    }, 2800);
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    formErrors.hidden = true;
    formErrors.innerHTML = "";

    const filesToUpload = fileInput.files;
    if (filesToUpload.length === 0) {
      formErrors.innerHTML = `<div>Please choose at least one file to upload.</div>`;
      formErrors.hidden = false;
      return;
    }

    const title = document.getElementById("titleInput").value.trim();
    const subject = document.getElementById("subjectSelect").value;

    // Basic client-side validation for title and subject
    const clientErrors = [];
    if (!title) clientErrors.push("Title is required.");
    if (!subject) clientErrors.push("Please choose a valid subject.");
    if (clientErrors.length > 0) {
      formErrors.innerHTML = clientErrors.map(e => `<div>${escapeHtml(e)}</div>`).join("");
      formErrors.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.querySelector(".btn-label").style.opacity = "0.5";
    submitBtn.querySelector(".btn-spinner").hidden = false;
    uploadProgressWrap.hidden = false; // Show progress wrapper

    const totalFiles = filesToUpload.length;
    let uploadedCount = 0;
    let failedCount = 0;
    const errorsDuringUpload = [];

    // Individual file upload loop
    for (let i = 0; i < totalFiles; i++) {
      const file = filesToUpload[i];
      const singleFileFormData = new FormData();
      singleFileFormData.append("title", title); // Original title, server will append (X)
      singleFileFormData.append("subject", subject);
      singleFileFormData.append("file", file);

      uploadProgressText.textContent = `Uploading file ${i + 1} of ${totalFiles} (${escapeHtml(file.name)})…`;
      uploadProgressBar.style.width = `${((uploadedCount + failedCount) / totalFiles) * 100}%`;

      try {
        const res = await fetch("/upload", {
          method: "POST",
          headers: { "X-Requested-With": "fetch" },
          body: singleFileFormData,
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          failedCount++;
          errorsDuringUpload.push(data.errors ? data.errors.join("; ") : `Failed to upload ${escapeHtml(file.name)}.`);
        } else {
          uploadedCount++;
        }
      } catch (err) {
        failedCount++;
        errorsDuringUpload.push(`Network error for ${escapeHtml(file.name)}: ${err.message || "Unknown error"}.`);
      }
    }

    // Final progress update
    uploadProgressBar.style.width = "100%";
    uploadProgressText.textContent = "Processing complete.";

    if (failedCount > 0) {
      formErrors.innerHTML = `<div>${uploadedCount} file(s) uploaded, ${failedCount} file(s) failed:</div>` +
                             errorsDuringUpload.map(e => `<div>• ${escapeHtml(e)}</div>`).join("");
      formErrors.hidden = false;
      showToast("Some files failed to upload. See errors.", true);
    } else {
      showToast("File(s) uploaded successfully.");
    }

    // After a short delay for user to read final progress/toast
    setTimeout(() => {
      closeModal();
      const currentSlug = window.location.pathname.startsWith("/subject/")
        ? window.location.pathname.split("/subject/")[1]
        : null;

      // If any files uploaded successfully, redirect to the subject page.
      if (uploadedCount > 0) {
        if (currentSlug === subject) {
          window.location.reload(); // Refresh if already on the subject page
        } else {
          window.location.href = `/subject/${subject}`; // Redirect to the subject page
        }
      } else {
        // All uploads failed, no redirect, just close modal.
      }
    }, 1200);

    submitBtn.disabled = false;
    submitBtn.querySelector(".btn-label").style.opacity = "1";
    submitBtn.querySelector(".btn-spinner").hidden = true;
  });

  /* ------------------------------------------------------------------ */
  /* Delete upload                                                       */
  /* ------------------------------------------------------------------ */

  document.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest(".file-delete-btn");
    if (!deleteBtn) return;

    const fileId = deleteBtn.dataset.fileId;
    const fileTitle = deleteBtn.dataset.fileTitle;

    if (!confirm(`Delete "${escapeHtml(fileTitle)}"? This action cannot be undone.`)) {
      return;
    }

    const fileCard = deleteBtn.closest(".file-card");
    if (!fileCard) return;

    fileCard.style.opacity = "0.6"; // Indicate loading
    deleteBtn.disabled = true; // Disable button during deletion

    try {
      const res = await fetch(`/api/delete/${fileId}`, {
        method: "DELETE",
        headers: { "X-Requested-With": "fetch" },
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Deletion failed. Please try again.");
      }

      // Fade out and remove the card
      fileCard.classList.add("fading-out");
      fileCard.addEventListener("transitionend", () => {
        fileCard.remove();
        // Check if the file grid is now empty
        const fileGrid = document.getElementById("fileGrid");
        // If the grid becomes truly empty after removal (no other file cards, and no empty-state div yet)
        // or if all file-cards are removed (which implies the empty-state will be rendered by server on reload)
        if (!fileGrid || fileGrid.querySelectorAll('.file-card').length === 0) {
          window.location.reload(); // Reload to show server-rendered empty state
        }
      }, { once: true });

      showToast("Upload deleted successfully.");
    } catch (err) {
      console.error("Deletion error:", err);
      fileCard.style.opacity = "1"; // Restore opacity on error
      deleteBtn.disabled = false; // Re-enable button
      showToast(err.message || "Failed to delete upload.", true);
    }
  });

  /* ------------------------------------------------------------------ */
  /* Lightbox (full-size image preview)                                  */
  /* ------------------------------------------------------------------ */

  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const lightboxClose = document.getElementById("lightboxClose");

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-lightbox]");
    if (!trigger) return;
    e.preventDefault();
    lightboxImg.src = trigger.dataset.lightbox;
    lightboxImg.alt = trigger.alt || "";
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  });

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.src = "";
    document.body.style.overflow = "";
  }

  lightboxClose?.addEventListener("click", closeLightbox);
  lightbox?.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox && !lightbox.hidden) closeLightbox();
  });
})();