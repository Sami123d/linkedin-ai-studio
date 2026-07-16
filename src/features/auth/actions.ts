"use server";

import { redirect } from "next/navigation";

import { clientEnv } from "@/config/env.client";
import { createClient } from "@/lib/supabase/server";
import {
  type LoginInput,
  type RegisterInput,
  loginSchema,
  registerSchema,
} from "@/validation/auth";

export type AuthActionResult =
  { error: string } | { success: true; message: string } | undefined;

export async function login(input: LoginInput): Promise<AuthActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid email or password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}

export async function register(
  input: RegisterInput,
): Promise<AuthActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Please fix the errors and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (data.session) {
    redirect("/dashboard");
  }

  return {
    success: true,
    message: "Check your email to confirm your account before logging in.",
  };
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
