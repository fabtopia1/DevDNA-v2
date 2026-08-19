import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() @MinLength(2) @MaxLength(120)
  organizationName!: string;

  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsEmail() @MaxLength(200)
  email!: string;

  /**
   * 12 characters minimum. Shop staff share workstations and reuse passwords
   * heavily; length is the only control that reliably survives that.
   */
  @IsString() @MinLength(12) @MaxLength(200)
  password!: string;
}

export class LoginDto {
  @IsEmail() @MaxLength(200)
  email!: string;

  @IsString() @MinLength(1) @MaxLength(200)
  password!: string;
}

export class RefreshDto {
  @IsString() @MinLength(10)
  refreshToken!: string;
}

export class InviteUserDto {
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsEmail() @MaxLength(200)
  email!: string;

  @IsString() @MinLength(12) @MaxLength(200)
  password!: string;

  @IsOptional() @IsString()
  role?: 'ADMIN' | 'TECHNICIAN' | 'VIEWER';
}
