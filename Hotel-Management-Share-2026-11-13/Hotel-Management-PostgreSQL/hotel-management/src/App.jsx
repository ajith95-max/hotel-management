import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useDispatch, useSelector } from "react-redux";
import Pagination from "./Pagination.jsx";
import { hotelsLoaded, loadingFailed, loadingStarted } from "./store.js";

const defaultImage =
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=85";
const hotelTypes = ["Hotel", "Resort", "Inn"];
const roomTypes = ["Standard", "Deluxe", "Suite"];
const amenityOptions = ["Wi-Fi", "Pool", "Restaurant", "Parking"];

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "The request could not be completed.");
    error.fields = payload.fields || {};
    throw error;
  }
  return payload;
}

function Header({ favoriteCount }) {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Stayfinder home">
        <span className="brand-mark" aria-hidden="true">s</span>
        <span>stayfinder<span className="brand-period">.</span></span>
      </Link>
      <nav className="main-nav" aria-label="Main navigation">
        <NavLink to="/" end>Discover</NavLink>
        <Link to="/about">About</Link>
        <Link to="/?favoriteOnly=1">Favourites ({favoriteCount})</Link>
      </nav>
      <form className="header-search" onSubmit={(event) => {
        event.preventDefault();
        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        navigate(`/?${params}`);
      }}>
        <input aria-label="Search hotels in header" placeholder="Search hotels" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button type="submit" aria-label="Search">⌕</button>
      </form>
      <Link className="button button-dark header-cta" to="/hotels/new">
        <span aria-hidden="true">+</span> Add a stay
      </Link>
    </header>
  );
}

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(onDismiss, 4200);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.type || "success"}`} role="status">
      <span className="toast-icon" aria-hidden="true">{toast.type === "error" ? "!" : "✓"}</span>
      <span>{toast.message}</span>
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss notification">×</button>
    </div>
  );
}

function HotelCard({ hotel, onDelete, deleting, favorite, onFavorite }) {
  const navigate = useNavigate();
  return (
    <article className="hotel-card" onClick={(event) => {
      if (!event.target.closest("a, button")) navigate(`/hotels/${hotel.id}`);
    }}>
      <Link className="card-image-link" to={`/hotels/${hotel.id}`} aria-label={`View ${hotel.title}`}>
        <img
          className="card-image"
          src={hotel.imageUrl || defaultImage}
          alt={`A view of ${hotel.title}`}
          loading="lazy"
          onError={(event) => { event.currentTarget.src = defaultImage; }}
        />
        <span className="image-arrow" aria-hidden="true">↗</span>
      </Link>
      <div className="card-body">
        <div className="card-heading">
          <Link to={`/hotels/${hotel.id}`} className="hotel-title">{hotel.title}</Link>
          <button type="button" className="favorite-button" onClick={() => onFavorite(hotel.id)} aria-label={`${favorite ? "Remove" : "Add"} ${hotel.title} ${favorite ? "from" : "to"} favourites`} aria-pressed={favorite}>{favorite ? "♥" : "♡"}</button>
        </div>
        {hotel.rating && <p className="card-rating" aria-label={`${hotel.rating} out of 5 stars`}>{"★".repeat(hotel.rating)}{"☆".repeat(5 - hotel.rating)} <span>{hotel.rating}/5</span></p>}
        {(hotel.hotelType || hotel.location) && <p className="card-meta">{[hotel.hotelType, hotel.location].filter(Boolean).join(" · ")}</p>}
        <p className="hotel-description">{hotel.description}</p>
        <div className="card-bottom">
          <p className="price"><strong>₹{Number(hotel.price).toLocaleString("en-IN")}</strong><span> / night</span></p>
          <div className="card-actions">
            <Link className="text-action" to={`/hotels/${hotel.id}`}>View details</Link>
            <Link className="text-action" to={`/hotels/${hotel.id}/edit`}>Edit</Link>
            <button
              className="text-action delete-action"
              onClick={() => onDelete(hotel)}
              disabled={deleting}
              aria-label={`Delete ${hotel.title}`}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ListingPage({ notify, favorites, toggleFavorite }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") || "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") || "");
  const [hotelType, setHotelType] = useState(searchParams.get("hotelType") || "");
  const [location, setLocation] = useState(searchParams.get("location") || "");
  const [roomType, setRoomType] = useState(searchParams.get("roomType") || "");
  const [rating, setRating] = useState(searchParams.get("rating") || "");
  const [amenities, setAmenities] = useState(searchParams.get("amenities")?.split(",") || []);
  const [view, setView] = useState("list");
  const dispatch = useDispatch();
  const { data, loading, error } = useSelector((state) => state.hotels);
  const [deletingId, setDeletingId] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const page = Number(searchParams.get("page")) || 1;
  const query = searchParams.toString();
  const favoriteOnly = searchParams.get("favoriteOnly") === "1";
  const favoriteKey = favorites.join(",");

  useEffect(() => {
    const controller = new AbortController();
    dispatch(loadingStarted());
    const params = new URLSearchParams(query);
    params.delete("favoriteOnly");
    if (favoriteOnly) params.set("favorites", favoriteKey || "none");
    api(`/api/hotels?${params}`, { signal: controller.signal })
      .then((result) => dispatch(hotelsLoaded(result)))
      .catch((requestError) => {
        if (requestError.name !== "AbortError") dispatch(loadingFailed(requestError.message));
      });
    return () => controller.abort();
  }, [dispatch, query, refresh, favoriteOnly, favoriteKey]);

  useEffect(() => {
    setSearch(searchParams.get("search") || "");
    setMinPrice(searchParams.get("minPrice") || "");
    setMaxPrice(searchParams.get("maxPrice") || "");
    setHotelType(searchParams.get("hotelType") || "");
    setLocation(searchParams.get("location") || "");
    setRoomType(searchParams.get("roomType") || "");
    setRating(searchParams.get("rating") || "");
    setAmenities(searchParams.get("amenities")?.split(",") || []);
  }, [query]);

  function applyFilters(event) {
    event.preventDefault();
    if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) {
      notify("Minimum price cannot exceed maximum price.", "error");
      return;
    }
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    if (hotelType) params.set("hotelType", hotelType);
    if (location.trim()) params.set("location", location.trim());
    if (roomType) params.set("roomType", roomType);
    if (rating) params.set("rating", rating);
    if (amenities.length) params.set("amenities", amenities.join(","));
    if (favoriteOnly) params.set("favoriteOnly", "1");
    if (searchParams.get("sort")) params.set("sort", searchParams.get("sort"));
    setSearchParams(params);
  }

  async function deleteHotel(hotel) {
    if (!window.confirm(`Delete "${hotel.title}"? This can't be undone.`)) return;
    setDeletingId(hotel.id);
    try {
      const result = await api(`/api/hotels/${hotel.id}`, { method: "DELETE" });
      if (favorites.includes(String(hotel.id))) toggleFavorite(hotel.id);
      if (data.hotels.length === 1 && page > 1) goToPage(page - 1);
      else setRefresh((current) => current + 1);
      notify(result.warning || "Hotel deleted successfully.");
    } catch (requestError) {
      notify(requestError.message, "error");
    } finally {
      setDeletingId(null);
    }
  }

  function goToPage(nextPage) {
    const params = new URLSearchParams(searchParams);
    if (nextPage <= 1) params.delete("page");
    else params.set("page", String(nextPage));
    setSearchParams(params);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <Helmet defer={false}>
        <title>Find a stay | Stayfinder</title>
        <meta name="description" content="Browse thoughtful stays, find the right price, and plan your next hotel getaway." />
      </Helmet>
      <main>
        <section className="category-banner">
          <h1>Browse hotels</h1>
          <nav aria-label="Breadcrumb"><Link to="/">Home</Link><span aria-hidden="true"> / </span><span aria-current="page">Hotels</span></nav>
        </section>

        <section className="listing-section" id="stays">
          <div className="listing-layout">
          <form className="filter-bar" onSubmit={applyFilters} aria-label="Hotel filters">
            <h2 className="filter-heading">Find your stay</h2>
            <label className="search-field">
              <span className="field-icon" aria-hidden="true">⌕</span>
              <span className="visually-hidden">Search by hotel name</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Where do you want to stay?" />
            </label>
            <label className="filter-price">
              <span className="filter-label">Min price</span>
              <span className="price-input"><span>₹</span><input aria-label="Minimum price per night" type="number" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="Any" /></span>
            </label>
            <label className="filter-price">
              <span className="filter-label">Max price</span>
              <span className="price-input"><span>₹</span><input aria-label="Maximum price per night" type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Any" /></span>
            </label>
            <label className="filter-field"><span>Hotel type</span><select value={hotelType} onChange={(event) => setHotelType(event.target.value)}><option value="">All types</option>{hotelTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="filter-field"><span>Location</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City or area" /></label>
            <label className="filter-field"><span>Room type</span><select value={roomType} onChange={(event) => setRoomType(event.target.value)}><option value="">All rooms</option>{roomTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="filter-field"><span>Minimum rating</span><select value={rating} onChange={(event) => setRating(event.target.value)}><option value="">Any rating</option>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} stars & up</option>)}</select></label>
            <fieldset className="amenity-filters"><legend>Amenities</legend>{amenityOptions.map((value) => <label key={value}><input type="checkbox" checked={amenities.includes(value)} onChange={(event) => setAmenities((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} />{value}</label>)}</fieldset>
            <label className="favorite-filter"><input type="checkbox" checked={favoriteOnly} onChange={(event) => {
              const params = new URLSearchParams(searchParams);
              if (event.target.checked) params.set("favoriteOnly", "1"); else params.delete("favoriteOnly");
              params.delete("page");
              setSearchParams(params);
            }} /> Favourites only</label>
            <button className="button button-dark filter-button" type="submit">Find stays <span aria-hidden="true">↗</span></button>
          </form>

          <div className="listing-results">
          <div className="section-heading">
            <h2>Hotels</h2>
            <p className="result-count">{loading ? "Finding your stay…" : `${data.pagination.total} ${data.pagination.total === 1 ? "stay" : "stays"} to explore`}</p>
          </div>
          <div className="results-toolbar">
            <label>Sort by <select aria-label="Sort hotels" value={searchParams.get("sort") || "newest"} onChange={(event) => {
              const params = new URLSearchParams(searchParams);
              if (event.target.value === "newest") params.delete("sort"); else params.set("sort", event.target.value);
              params.delete("page");
              setSearchParams(params);
            }}><option value="newest">Newest</option><option value="name">Name</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select></label>
            <div className="view-switch" aria-label="Display mode"><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>List</button><button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>Grid</button></div>
          </div>
          {error && <div className="inline-error" role="alert">{error} <button onClick={() => setRefresh((current) => current + 1)}>Try again</button></div>}
          {loading && <div className="loading-grid" aria-label="Loading hotels"><span /><span /><span /></div>}
          {!loading && !error && data.hotels.length === 0 && (
            <div className="empty-state"><span className="empty-icon" aria-hidden="true">⌂</span><h3>No stays found just yet.</h3><p>Try a different name or widen your filters.</p><button className="text-action" onClick={() => setSearchParams({})}>Clear filters</button></div>
          )}
          {!loading && !error && data.hotels.length > 0 && (
            <div className={`hotel-grid ${view === "grid" ? "hotel-grid-view" : ""}`}>
              {data.hotels.map((hotel) => <HotelCard key={hotel.id} hotel={hotel} onDelete={deleteHotel} deleting={deletingId === hotel.id} favorite={favorites.includes(String(hotel.id))} onFavorite={(id) => {
                if (favoriteOnly && page > 1) { const params = new URLSearchParams(searchParams); params.delete("page"); setSearchParams(params); }
                toggleFavorite(id);
              }} />)}
            </div>
          )}

          {!loading && !error && <Pagination page={page} totalPages={data.pagination.totalPages} onPageChange={goToPage} />}
          </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function HotelFormPage({ notify }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  const [form, setForm] = useState({ title: "", description: "", latitude: "", longitude: "", price: "", hotelType: "", location: "", roomType: "", rating: "", amenities: [] });
  const [currentImage, setCurrentImage] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(isEditing);
  const [recordLoadFailed, setRecordLoadFailed] = useState(false);

  useEffect(() => {
    if (!isEditing) return undefined;
    const controller = new AbortController();
    api(`/api/hotels/${id}`, { signal: controller.signal })
      .then(({ hotel }) => {
        setForm({
          title: hotel.title,
          description: hotel.description,
          latitude: String(hotel.latitude),
          longitude: String(hotel.longitude),
          price: String(hotel.price),
          hotelType: hotel.hotelType || "",
          location: hotel.location || "",
          roomType: hotel.roomType || "",
          rating: hotel.rating ? String(hotel.rating) : "",
          amenities: hotel.amenities || [],
        });
        setCurrentImage(hotel.imageUrl || "");
      })
      .catch((error) => { if (error.name !== "AbortError") { setLoadError(error.message); setRecordLoadFailed(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoadingRecord(false); });
    return () => controller.abort();
  }, [id, isEditing]);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(imageFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setErrors((current) => ({ ...current, [event.target.name]: "" }));
  }

  function selectImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setErrors((current) => ({ ...current, image: "Choose a JPG, PNG, or WebP image." }));
      setImageFile(null);
      event.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors((current) => ({ ...current, image: "Image must be 5 MB or smaller." }));
      setImageFile(null);
      event.target.value = "";
      return;
    }
    setErrors((current) => ({ ...current, image: "" }));
    setImageFile(file);
  }

  async function submit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (errors.image) nextErrors.image = errors.image;
    if (!form.title.trim()) nextErrors.title = "Add a hotel name.";
    if (!form.description.trim()) nextErrors.description = "Add a short description.";
    if (!form.latitude.trim() || !Number.isFinite(Number(form.latitude)) || Number(form.latitude) < -90 || Number(form.latitude) > 90) nextErrors.latitude = "Use a latitude between -90 and 90.";
    if (!form.longitude.trim() || !Number.isFinite(Number(form.longitude)) || Number(form.longitude) < -180 || Number(form.longitude) > 180) nextErrors.longitude = "Use a longitude between -180 and 180.";
    if (!form.price.trim() || !Number.isFinite(Number(form.price)) || Number(form.price) <= 0) nextErrors.price = "Enter a price greater than 0.";
    if (Object.values(nextErrors).some(Boolean)) {
      setErrors(nextErrors);
      return;
    }

    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key !== "amenities") body.append(key, value);
    });
    if (form.amenities.length) form.amenities.forEach((value) => body.append("amenities", value));
    else body.append("amenities", "");
    if (imageFile) body.append("image", imageFile);
    setSaving(true);
    setErrors({});
    setLoadError("");
    try {
      const result = await api(`/api/hotels${isEditing ? `/${id}` : ""}`, {
        method: isEditing ? "PUT" : "POST",
        body,
      });
      notify(result.warning || (isEditing ? "Stay updated successfully." : "Your new stay is ready."));
      navigate(`/hotels/${result.hotel.id}`);
    } catch (error) {
      setErrors(error.fields || {});
      if (!Object.keys(error.fields || {}).length) setLoadError(error.message);
    } finally {
      setSaving(false);
    }
  }

  const image = previewUrl || currentImage;

  return (
    <>
      <Helmet defer={false}><title>{isEditing ? "Edit stay" : "Add a stay"} | Stayfinder</title><meta name="description" content="Add or update the details for a hotel stay." /></Helmet>
      <main className="form-page">
        <Link className="back-link" to={isEditing ? `/hotels/${id}` : "/"}>← <span>{isEditing ? "Back to stay" : "Back to discover"}</span></Link>
        <div className="form-layout">
          <div className="form-intro">
            <p className="eyebrow"><span className="eyebrow-line" /> Your little corner of the world</p>
            <h1>{isEditing ? <>Make it<br /><em>just right.</em></> : <>List your<br /><em>lovely stay.</em></>}</h1>
            <p>Every great getaway starts with a place worth finding. Share the details and let travelers discover yours.</p>
            <div className="form-decoration" aria-hidden="true">✳</div>
          </div>
          <form className="hotel-form" onSubmit={submit} noValidate>
            <fieldset disabled={loadingRecord || recordLoadFailed} className="hotel-form-fields">
            <div className="form-topline"><span>{isEditing ? "Edit the details" : "The essentials"}</span><span>01 / 01</span></div>
            {loadError && <p className="form-error" role="alert">{loadError}</p>}
            <label className="upload-area">
              {image ? (
                <img className="upload-preview" src={image} alt="Preview of the hotel" onError={(event) => { event.currentTarget.src = defaultImage; }} />
              ) : (
                <span className="upload-placeholder"><span aria-hidden="true">↥</span><strong>Drop a beautiful photo here</strong><small>or browse from your device · JPG, PNG, WebP · 5 MB max</small></span>
              )}
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} aria-label="Upload a hotel image" />
              {image && <span className="change-photo">Change photo</span>}
            </label>
            {errors.image && <p className="field-error" role="alert">{errors.image}</p>}

            <div className="form-field">
              <label htmlFor="title">Hotel name <span>*</span></label>
              <input id="title" name="title" value={form.title} onChange={updateField} maxLength="120" placeholder="e.g. The Sunday House" aria-invalid={Boolean(errors.title)} />
              {errors.title && <p className="field-error">{errors.title}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="description">A little about it <span>*</span></label>
              <textarea id="description" name="description" value={form.description} onChange={updateField} maxLength="2000" rows="4" placeholder="What makes this place special?" aria-invalid={Boolean(errors.description)} />
              <div className="field-meta">{errors.description ? <p className="field-error">{errors.description}</p> : <span>Keep it lovely and under 2,000 characters.</span>}<span>{form.description.length}/2000</span></div>
            </div>
            <div className="form-field">
              <label>Location coordinates <span>*</span></label>
              <div className="coordinate-fields">
                <div><input aria-label="Latitude" name="latitude" type="number" step="any" value={form.latitude} onChange={updateField} placeholder="Latitude" aria-invalid={Boolean(errors.latitude)} />{errors.latitude && <p className="field-error">{errors.latitude}</p>}</div>
                <div><input aria-label="Longitude" name="longitude" type="number" step="any" value={form.longitude} onChange={updateField} placeholder="Longitude" aria-invalid={Boolean(errors.longitude)} />{errors.longitude && <p className="field-error">{errors.longitude}</p>}</div>
              </div>
              <small className="hint">These coordinates place your stay on the map.</small>
            </div>
            <div className="form-field">
              <label htmlFor="price">Price per night <span>*</span></label>
              <div className="currency-input"><span>₹</span><input id="price" name="price" type="number" min="1" step="1" value={form.price} onChange={updateField} placeholder="0" aria-invalid={Boolean(errors.price)} /></div>
              {errors.price && <p className="field-error">{errors.price}</p>}
            </div>
            <div className="form-field"><label htmlFor="hotelType">Hotel type</label><select id="hotelType" name="hotelType" value={form.hotelType} onChange={updateField}><option value="">Not specified</option>{hotelTypes.map((value) => <option key={value}>{value}</option>)}</select>{errors.hotelType && <p className="field-error">{errors.hotelType}</p>}</div>
            <div className="form-field"><label htmlFor="location">City or area</label><input id="location" name="location" maxLength="120" value={form.location} onChange={updateField} />{errors.location && <p className="field-error">{errors.location}</p>}</div>
            <div className="form-field"><label htmlFor="roomType">Room type</label><select id="roomType" name="roomType" value={form.roomType} onChange={updateField}><option value="">Not specified</option>{roomTypes.map((value) => <option key={value}>{value}</option>)}</select>{errors.roomType && <p className="field-error">{errors.roomType}</p>}</div>
            <div className="form-field"><label htmlFor="rating">Hotel rating</label><select id="rating" name="rating" value={form.rating} onChange={updateField}><option value="">Not specified</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} stars</option>)}</select>{errors.rating && <p className="field-error">{errors.rating}</p>}</div>
            <fieldset className="amenity-filters form-amenities"><legend>Amenities</legend>{amenityOptions.map((value) => <label key={value}><input type="checkbox" checked={form.amenities.includes(value)} onChange={(event) => setForm((current) => ({ ...current, amenities: event.target.checked ? [...current.amenities, value] : current.amenities.filter((item) => item !== value) }))} />{value}</label>)}{errors.amenities && <p className="field-error">{errors.amenities}</p>}</fieldset>
            {loadError && !Object.keys(errors).length && <p className="field-error" role="alert">{loadError}</p>}
            <button className="button button-dark submit-button" type="submit" disabled={saving || loadingRecord}>
              {loadingRecord ? "Loading your stay…" : saving ? "Saving your stay…" : isEditing ? "Save changes" : "Add this stay"} <span aria-hidden="true">↗</span>
            </button>
            <p className="required-note">Fields marked with * are required.</p>
            </fieldset>
          </form>
        </div>
      </main>
      <Footer />
    </>
  );
}

function DetailPage({ notify, favorites, toggleFavorite }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [hotel, setHotel] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [locationMessage, setLocationMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api(`/api/hotels/${id}`, { signal: controller.signal })
      .then(({ hotel: result }) => setHotel(result))
      .catch((requestError) => { if (requestError.name !== "AbortError") setError(requestError.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  async function removeHotel() {
    if (!hotel || !window.confirm(`Delete "${hotel.title}"? This can't be undone.`)) return;
    try {
      const result = await api(`/api/hotels/${id}`, { method: "DELETE" });
      if (favorites.includes(String(id))) toggleFavorite(id);
      notify(result.warning || "Hotel deleted successfully.");
      navigate("/");
    } catch (requestError) {
      notify(requestError.message, "error");
    }
  }

  function showDistance() {
      if (!navigator.geolocation) {
        setLocationMessage("Your browser does not support geolocation.");
        return;
      }
      setLocationMessage("Finding your location…");
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const toRadians = (degrees) => degrees * Math.PI / 180;
          const latitudeDifference = toRadians(Number(hotel.latitude) - coords.latitude);
          const longitudeDifference = toRadians(Number(hotel.longitude) - coords.longitude);
          const a = Math.sin(latitudeDifference / 2) ** 2 +
            Math.cos(toRadians(coords.latitude)) * Math.cos(toRadians(Number(hotel.latitude))) *
            Math.sin(longitudeDifference / 2) ** 2;
          const distance = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
          setLocationMessage(`Approximately ${distance.toFixed(1)} km from your current location (straight-line distance).`);
        },
        (error) => {
          setLocationMessage(error.code === 1
            ? "Location permission was denied. The hotel map remains available below."
            : "Your location could not be determined. Please try again.");
        },
        { timeout: 10000, maximumAge: 60000 },
      );
  }

  if (loading) return <main className="detail-page"><p className="loading-copy">Finding the details…</p></main>;
  if (error || !hotel) return <main className="detail-page"><div className="empty-state"><h2>We couldn't find this stay.</h2><p>{error || "It may have been removed."}</p><Link className="button button-dark" to="/">Back to stays</Link></div></main>;

  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${hotel.longitude - 0.02}%2C${hotel.latitude - 0.015}%2C${hotel.longitude + 0.02}%2C${hotel.latitude + 0.015}&layer=mapnik&marker=${hotel.latitude}%2C${hotel.longitude}`;

  return (
    <>
      <Helmet defer={false}><title>{hotel.title} | Stayfinder</title><meta name="description" content={hotel.description} /><meta property="og:title" content={`${hotel.title} | Stayfinder`} /><meta property="og:description" content={hotel.description} /><meta property="og:image" content={hotel.imageUrl || defaultImage} /></Helmet>
      <main className="detail-page">
        <Link className="back-link" to="/">← <span>All stays</span></Link>
        <div className="detail-hero">
          <img src={hotel.imageUrl || defaultImage} alt={`A view of ${hotel.title}`} onError={(event) => { event.currentTarget.src = defaultImage; }} />
          <div className="detail-image-caption"><span>Somewhere special</span><span aria-hidden="true">✳</span></div>
        </div>
        <div className="detail-layout">
          <section className="detail-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> Your next favorite place</p>
            <h1>{hotel.title}<span className="brand-period">.</span></h1>
            <p className="detail-description">{hotel.description}</p>
            {hotel.rating && <p className="card-rating" aria-label={`${hotel.rating} out of 5 stars`}>{"★".repeat(hotel.rating)}{"☆".repeat(5 - hotel.rating)} ({hotel.rating}/5)</p>}
            {(hotel.hotelType || hotel.location || hotel.roomType) && <p className="card-meta">{[hotel.hotelType, hotel.location, hotel.roomType].filter(Boolean).join(" · ")}</p>}
            {hotel.amenities?.length > 0 && <p className="card-meta">Amenities: {hotel.amenities.join(", ")}</p>}
            <div className="detail-location"><span aria-hidden="true">⌖</span><span>Coordinates<br /><strong>{Number(hotel.latitude).toFixed(4)}, {Number(hotel.longitude).toFixed(4)}</strong></span></div>
          </section>
          <aside className="booking-card">
            <p className="booking-label">A lovely stay from</p>
            <p className="booking-price"><strong>₹{Number(hotel.price).toLocaleString("en-IN")}</strong><span> / night</span></p>
            <a className="button button-dark booking-button" href={`https://www.openstreetmap.org/?mlat=${hotel.latitude}&mlon=${hotel.longitude}#map=15/${hotel.latitude}/${hotel.longitude}`} target="_blank" rel="noreferrer">Explore the area <span aria-hidden="true">↗</span></a>
            <div className="booking-actions"><Link className="text-action" to={`/hotels/${hotel.id}/edit`}>Edit stay</Link><button className="text-action delete-action" onClick={removeHotel}>Delete</button></div>
          </aside>
        </div>
        <section className="map-section">
          <div className="map-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> Find your way</p><h2>On the <em>map.</em></h2></div><a className="text-action" href={`https://www.openstreetmap.org/?mlat=${hotel.latitude}&mlon=${hotel.longitude}#map=15/${hotel.latitude}/${hotel.longitude}`} target="_blank" rel="noreferrer">Open map ↗</a></div>
          <p><button className="text-action" type="button" onClick={showDistance}>Find distance from my location</button></p>
          {locationMessage && <p className="location-message" role="status">{locationMessage}</p>}
          <iframe title={`Map showing ${hotel.title}`} src={mapUrl} loading="lazy" referrerPolicy="no-referrer" />
        </section>
      </main>
      <Footer />
    </>
  );
}

function Footer() {
  return (
    <footer className="site-footer" id="about">
      <Link className="brand footer-brand" to="/"><span className="brand-mark" aria-hidden="true">s</span><span>stayfinder<span className="brand-period">.</span></span></Link>
      <nav className="footer-nav" aria-label="Footer"><Link to="/about">About</Link><Link to="/contact">Contact</Link><Link to="/support">Support</Link></nav>
      <span className="footer-copy">© {new Date().getFullYear()} Stayfinder. Demo project.</span>
    </footer>
  );
}

function InformationPage({ page }) {
  const content = {
    about: ["About", "Stayfinder is a demonstration hotel listing and management application. Hotel details are illustrative and should be verified before use."],
    contact: ["Contact", "This demo has no configured contact service. For project enquiries, contact the organization that shared this application."],
    support: ["Support", "Search by hotel name or use the filters to find a stay. Use Add a stay to create a record, and Edit or Delete to manage it. For setup help, see the project README."],
  }[page];
  return <><Helmet defer={false}><title>{content[0]} | Stayfinder</title><meta name="description" content={content[1]} /></Helmet><main className="information-page"><h1>{content[0]}</h1><p>{content[1]}</p><Link className="text-action" to="/">Back to hotels</Link></main><Footer /></>;
}

export default function App() {
  const [toast, setToast] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("stayfinder-favorites") || "[]");
      if (!Array.isArray(saved) || saved.some((id) => !/^[1-9]\d*$/.test(String(id)))) throw new Error("Invalid favourites data.");
      return [...new Set(saved.map(String))];
    } catch (error) {
      console.error("Could not read saved favourites:", error);
      return [];
    }
  });
  function notify(message, type = "success") {
    setToast({ message, type, id: Date.now() });
  }
  function dismissToast() {
    setToast(null);
  }
  function toggleFavorite(id) {
    const key = String(id);
    const next = favorites.includes(key) ? favorites.filter((item) => item !== key) : [...favorites, key];
    try {
      localStorage.setItem("stayfinder-favorites", JSON.stringify(next));
      setFavorites(next);
    } catch (error) {
      console.error("Could not save favourites:", error);
      notify("Favourites could not be saved in this browser.", "error");
    }
  }

  return (
    <div className="app-shell">
      <Header favoriteCount={favorites.length} />
      <Routes>
        <Route path="/" element={<ListingPage notify={notify} favorites={favorites} toggleFavorite={toggleFavorite} />} />
        <Route path="/hotels/new" element={<HotelFormPage notify={notify} />} />
        <Route path="/hotels/:id/edit" element={<HotelFormPage notify={notify} />} />
        <Route path="/hotels/:id" element={<DetailPage notify={notify} favorites={favorites} toggleFavorite={toggleFavorite} />} />
        <Route path="/about" element={<InformationPage page="about" />} />
        <Route path="/contact" element={<InformationPage page="contact" />} />
        <Route path="/support" element={<InformationPage page="support" />} />
        <Route path="*" element={<main className="empty-state"><h1>That page wandered off.</h1><Link className="button button-dark" to="/">Find a stay</Link></main>} />
      </Routes>
      <Toast key={toast?.id} toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
