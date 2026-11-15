import { configureStore, createSlice } from "@reduxjs/toolkit";

const hotelsSlice = createSlice({
  name: "hotels",
  initialState: {
    data: { hotels: [], pagination: { page: 1, total: 0, totalPages: 0 } },
    loading: true,
    error: "",
  },
  reducers: {
    loadingStarted(state) {
      state.loading = true;
      state.error = "";
    },
    hotelsLoaded(state, action) {
      state.data = action.payload;
      state.loading = false;
    },
    loadingFailed(state, action) {
      state.error = action.payload;
      state.loading = false;
    },
  },
});

export const { loadingStarted, hotelsLoaded, loadingFailed } = hotelsSlice.actions;
export const store = configureStore({ reducer: { hotels: hotelsSlice.reducer } });
