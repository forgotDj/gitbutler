import { configureStore } from "@reduxjs/toolkit";
import { projectReducer } from "#ui/routes/project/$id/state/projectSlice.ts";

export const store = configureStore({
	reducer: {
		project: projectReducer,
	},
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
