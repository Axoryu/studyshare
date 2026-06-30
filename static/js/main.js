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
  }

  function resetDropzone() {
    dropzoneContent.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <p><strong>Click to choose</strong> or drag a file here</p>
      <p class="dropzone-hint">JPG, PNG, WEBP, or PDF · up to 25 MB</p>`;
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
    const file = e.dataTransfer.files[0];
    if (file) {
      fileInput.files = e.dataTransfer.files;
      showFileName(file);
    }
  });

  fileInput?.addEventListener("change", () => {
    if (fileInput.files[0]) showFileName(fileInput.files[0]);
  });

  function showFileName(file) {
    dropzoneContent.innerHTML = `
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p class="dropzone-filename">${escapeHtml(file.name)}</p>
      <p class="dropzone-hint">Click to change file</p>`;
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.hidden = true;
    }, 2800);
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    formErrors.hidden = true;
    formErrors.innerHTML = "";

    const fd = new FormData(form);
    submitBtn.disabled = true;
    submitBtn.querySelector(".btn-label").style.opacity = "0.5";
    submitBtn.querySelector(".btn-spinner").hidden = false;

    try {
      const res = await fetch("/upload", {
        method: "POST",
        headers: { "X-Requested-With": "fetch" },
        body: fd,
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        formErrors.innerHTML = (data.errors || ["Upload failed. Please try again."])
          .map((e) => `<div>${escapeHtml(e)}</div>`)
          .join("");
        formErrors.hidden = false;
        return;
      }

      closeModal();
      showToast("File uploaded successfully.");

      const currentSlug = window.location.pathname.startsWith("/subject/")
        ? window.location.pathname.split("/subject/")[1]
        : null;

      if (currentSlug === data.subject_slug) {
        // Already on this subject's page — just refresh to show the new file.
        window.location.reload();
      } else {
        window.location.href = `/subject/${data.subject_slug}`;
      }
    } catch (err) {
      formErrors.innerHTML = `<div>Network error. Please check your connection and try again.</div>`;
      formErrors.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.querySelector(".btn-label").style.opacity = "1";
      submitBtn.querySelector(".btn-spinner").hidden = true;
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
